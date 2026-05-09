/**
 * Unit tests for the metrics registry. Pin: counter increment +
 * label semantics, histogram bucket placement + cumulative count,
 * Prometheus exposition format, label cardinality cap (DoS guard),
 * and double-registration with mismatched type.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { registry } from './services/metrics';

beforeEach(() => {
  registry.clearAll();
});

describe('metrics — counter', () => {
  it('HAPPY: inc() with no labels accumulates on the unlabeled series', () => {
    // WHO: a route that needs a single global tally (e.g. server
    //       restart count) — no labels needed
    // WHAT: repeated inc() bumps the same series
    // WHY: pin the simplest happy path. If counter() returned a fresh
    //       series each call, the tally would always be 1.
    const c = registry.counter('test_total', 'Test counter');
    c.inc();
    c.inc();
    c.inc();
    expect(c.snapshot()).toEqual([{ labels: {}, value: 3 }]);
  });

  it('HAPPY: different label combinations get separate series', () => {
    // WHO: HTTP middleware tagging requests with route + status
    // WHAT: GET /a 200 + GET /b 200 + GET /a 500 produces 3 distinct
    //       series, each with its own counter
    // WHY: this is the load-bearing semantic — Prometheus depends on
    //       label-keyed series to compute per-route success rates
    const c = registry.counter('reqs', 'reqs');
    c.inc({ route: '/a', status: '200' });
    c.inc({ route: '/b', status: '200' });
    c.inc({ route: '/a', status: '500' });
    c.inc({ route: '/a', status: '200' });

    const snap = c.snapshot();
    expect(snap).toHaveLength(3);
    const find = (l: Record<string, string>) =>
      snap.find((s) => s.labels.route === l.route && s.labels.status === l.status);
    expect(find({ route: '/a', status: '200' })?.value).toBe(2);
    expect(find({ route: '/b', status: '200' })?.value).toBe(1);
    expect(find({ route: '/a', status: '500' })?.value).toBe(1);
  });

  it('HAPPY: label-key sort order is stable — {a,b} and {b,a} are the same series', () => {
    // WHY: object insertion order is JS-defined but key order in the
    //       internal map key was being computed by sort() — verify that
    //       a caller passing labels in different orders still hits the
    //       same series. Otherwise we'd silently double-count.
    const c = registry.counter('x', 'x');
    c.inc({ a: '1', b: '2' });
    c.inc({ b: '2', a: '1' });
    expect(c.snapshot()).toHaveLength(1);
    expect(c.snapshot()[0].value).toBe(2);
  });

  it('SAD: cardinality cap funnels excess unique label combinations into __overflow__', () => {
    // WHO: a misbehaving caller (or a legit DoS) emitting a label-value
    //       per phone number / email — would otherwise pin process
    //       memory once a few thousand callers come through
    // WHAT: at MAX_LABEL_CARDINALITY (1000) hit, the next inc() lands
    //       on a single overflow series tagged overflow="true"
    // WHY: prom-client doesn't have this guard built in; we'd rather
    //       lose label resolution than crash the server. The overflow
    //       series itself is a signal we should fix the call site.
    const c = registry.counter('y', 'y');
    for (let i = 0; i < 1000; i++) c.inc({ id: `item-${i}` });
    c.inc({ id: 'overflow-1' });
    c.inc({ id: 'overflow-2' });

    const snap = c.snapshot();
    // 1000 base series + 1 overflow series
    expect(snap).toHaveLength(1001);
    const overflow = snap.find((s) => s.labels.overflow === 'true');
    expect(overflow?.value).toBe(2);
  });

  it('HAPPY: inc(labels, by=N) accepts a step value', () => {
    // WHY: some emit sites (batched dispatches) want to add 5 at once
    //       rather than calling inc() five times. Default by=1 keeps
    //       the common case clean.
    const c = registry.counter('batch', 'batch');
    c.inc({ kind: 'a' }, 5);
    c.inc({ kind: 'a' }, 3);
    expect(c.snapshot()[0].value).toBe(8);
  });
});

describe('metrics — histogram', () => {
  it('HAPPY: observe() places values in cumulative buckets', () => {
    // WHO: HTTP middleware recording request duration
    // WHAT: a 50ms request increments the 50, 100, 250, 500 buckets
    //       — Prometheus histograms are CUMULATIVE (le="50" means
    //       "<=50", and le="100" means "<=100" which includes the 50)
    // WHY: a refactor that switches to non-cumulative buckets would
    //       silently break every histogram_quantile() expression in
    //       Grafana dashboards
    const h = registry.histogram('h', 'h', [10, 50, 100, 250]);
    h.observe(50);
    const snap = h.snapshot();
    expect(snap).toHaveLength(1);
    // bucket[0] (le=10) → 0 (50 > 10)
    // bucket[1] (le=50) → 1 (50 <= 50)
    // bucket[2] (le=100) → 1 (50 <= 100)
    // bucket[3] (le=250) → 1 (50 <= 250)
    expect(snap[0].bucketCounts).toEqual([0, 1, 1, 1]);
    expect(snap[0].count).toBe(1);
    expect(snap[0].sum).toBe(50);
  });

  it('HAPPY: multiple observations accumulate sum + count', () => {
    // WHY: histogram_quantile(0.95, rate(...)) can't compute p95 if
    //       sum/count are off. Pin that they track every observation.
    const h = registry.histogram('h2', 'h2', [10, 100]);
    h.observe(5);
    h.observe(50);
    h.observe(150);
    const s = h.snapshot()[0];
    expect(s.count).toBe(3);
    expect(s.sum).toBe(205);
    // 5 lands in 10 + 100; 50 in 100 only; 150 in neither (only +Inf)
    expect(s.bucketCounts).toEqual([1, 2]);
  });

  it('HAPPY: separate label combinations get separate histograms', () => {
    // WHY: latency by route is the whole point — must not collapse
    //       /fast and /slow into a single distribution
    const h = registry.histogram('h3', 'h3', [100]);
    h.observe(50, { route: '/fast' });
    h.observe(500, { route: '/slow' });
    const snap = h.snapshot();
    expect(snap).toHaveLength(2);
  });

  it('SAD: non-ascending buckets throw at construction', () => {
    // WHY: prom-client requires sorted buckets and so does the
    //       Prometheus server. Catch the error at boot rather than
    //       letting it produce malformed scrapes.
    expect(() =>
      registry.histogram('bad', 'bad', [100, 50, 200])
    ).toThrow(/strictly ascending/i);
  });
});

describe('metrics — registry', () => {
  it('HAPPY: registering the same name twice returns the same instance', () => {
    // WHY: module load order can cause counter() to be called twice
    //       with the same name (e.g. two route modules both grabbing
    //       errorsTotal). Both should share state, not silently shadow.
    const c1 = registry.counter('shared', 'help');
    const c2 = registry.counter('shared', 'help');
    expect(c1).toBe(c2);
    c1.inc();
    expect(c2.snapshot()[0].value).toBe(1);
  });

  it('SAD: registering same name as different type throws', () => {
    // WHY: counter() then histogram() with the same name would
    //       produce malformed exposition (two TYPE lines for one
    //       name). Hard-fail at registration time.
    registry.counter('dual', 'help');
    expect(() => registry.histogram('dual', 'help', [10])).toThrow(/already registered/i);
  });

  it('HAPPY: expose() returns Prometheus text format with HELP + TYPE headers', () => {
    // WHO: Prometheus scraping the /metrics endpoint
    // WHAT: text exposition follows the format the Prometheus server
    //       expects — leading # HELP, # TYPE, then each series on its
    //       own line, ending with a newline
    // WHY: malformed exposition makes the scrape fail open-ended; the
    //       symptom is "no metrics in dashboard" with no obvious cause
    const c = registry.counter('expose_test_total', 'A test counter for exposition');
    c.inc({ outcome: 'ok' });
    c.inc({ outcome: 'fail' });

    const text = registry.expose();
    expect(text).toContain('# HELP expose_test_total A test counter for exposition');
    expect(text).toContain('# TYPE expose_test_total counter');
    expect(text).toMatch(/expose_test_total\{outcome="ok"\} 1/);
    expect(text).toMatch(/expose_test_total\{outcome="fail"\} 1/);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('HAPPY: histogram exposition emits _bucket / _sum / _count + +Inf', () => {
    // WHY: Prometheus's histogram_quantile() needs +Inf and _count;
    //       missing either makes the function silently return NaN. Pin
    //       the exposition so a refactor doesn't drop them.
    const h = registry.histogram('hexp_ms', 'hexp', [10, 100]);
    h.observe(5);
    h.observe(50);

    const text = registry.expose();
    expect(text).toContain('# TYPE hexp_ms histogram');
    expect(text).toMatch(/hexp_ms_bucket\{le="10"\} 1/);
    expect(text).toMatch(/hexp_ms_bucket\{le="100"\} 2/);
    expect(text).toMatch(/hexp_ms_bucket\{le="\+Inf"\} 2/);
    expect(text).toMatch(/hexp_ms_sum 55/);
    expect(text).toMatch(/hexp_ms_count 2/);
  });

  it('HAPPY: label values with quotes / backslashes / newlines are escaped', () => {
    // WHY: a route with a bare-quote in the URL would otherwise emit
    //       label="\"foo"" which fails to parse. Prometheus spec says
    //       \\ for backslash, \" for quote, \n for newline.
    const c = registry.counter('esc_total', 'escape test');
    c.inc({ raw: 'a"b\\c\nd' });

    const text = registry.expose();
    expect(text).toContain('raw="a\\"b\\\\c\\nd"');
  });
});
