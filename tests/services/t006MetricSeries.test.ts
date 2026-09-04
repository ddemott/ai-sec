/**
 * T-006 — the eight metric series monitoring is built on must EXIST in the
 * scrapeable output, not merely be declared somewhere.
 *
 * WHO: whoever wires an alert to /metrics (a Prometheus scrape, a Better Stack
 *      monitor, or `.github/workflows/zero-vendor-alerts.yml`).
 * WHAT: every series named in docs/ALERTS.md's rule catalog renders in
 *       registry.expose() with the label keys the rules filter on.
 * WHEN: CI, on every change to src/services/metrics.ts.
 * WHERE: the live singleton registry — the same object /metrics serves.
 * WHY: an alert filtering on a series that was renamed, or on a label the code
 *      never emits, matches NOTHING and stays green forever. That failure mode
 *      is silent by construction: the rule looks configured and the dashboard
 *      looks calm. `reminders_sent_total{channel=...}` was exactly this — a
 *      documented label no running code had ever emitted.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  registry,
  callsTotal,
  callOutcomeTotal,
  remindersSentTotal,
  remindersSkippedTotal,
  errorsTotal,
  turnLatencyMs,
  smsSendsTotal,
  webhookSignatureFailuresTotal,
} from '../../src/services/metrics';

/** Emit one sample into each series so it has something to expose. */
function emitOneOfEach(): void {
  callsTotal.inc({ source: 'phone' });
  callOutcomeTotal.inc({ outcome: 'booked' });
  remindersSentTotal.inc({ type: '24h', outcome: 'success' });
  remindersSkippedTotal.inc({ reason: 'no_consent' });
  errorsTotal.inc({ event: 'reminder_batch_failed' });
  turnLatencyMs.observe(1200);
  smsSendsTotal.inc({ provider: 'telnyx', outcome: 'sent' });
  webhookSignatureFailuresTotal.inc({ provider: 'stripe', endpoint: 'billing_webhook' });
}

describe('T-006 metric series contract', () => {
  beforeEach(() => {
    registry.clearAll();
  });

  it('HAPPY: all eight monitored series appear in the exposition', () => {
    emitOneOfEach();
    const out = registry.expose();
    for (const series of [
      'calls_total',
      'call_outcome_total',
      'reminders_sent_total',
      'reminders_skipped_total',
      'errors_total',
      'turn_latency_ms',
      'sms_sends_total',
      'webhook_signature_failures_total',
    ]) {
      expect(out, `missing series: ${series}`).toContain(`# TYPE ${series} `);
    }
  });

  it('HAPPY: each series carries the label keys docs/ALERTS.md filters on', () => {
    // A rule like `rate(errors_total{event="reminder_batch_failed"}[10m])`
    // silently matches nothing if the label key changes, so the KEYS are part
    // of the contract, not an implementation detail.
    emitOneOfEach();
    const out = registry.expose();
    expect(out).toContain('calls_total{source="phone"}');
    expect(out).toContain('call_outcome_total{outcome="booked"}');
    expect(out).toContain('errors_total{event="reminder_batch_failed"}');
    expect(out).toContain('sms_sends_total{outcome="sent",provider="telnyx"}');
    expect(out).toContain(
      'webhook_signature_failures_total{endpoint="billing_webhook",provider="stripe"}'
    );
    expect(out).toMatch(/reminders_sent_total\{outcome="success",type="24h"\}/);
    expect(out).toContain('reminders_skipped_total{reason="no_consent"}');
  });

  it('HAPPY: turn_latency_ms exposes a bucket either side of the 3000ms alert line', () => {
    // The p95 rule in docs/ALERTS.md fires above 3000ms. Prometheus interpolates
    // WITHIN a bucket, so with no edge at 3000 the alert would trigger off an
    // estimate rather than a measurement.
    turnLatencyMs.observe(1200);
    const out = registry.expose();
    expect(out).toContain('turn_latency_ms_bucket{le="2500"}');
    expect(out).toContain('turn_latency_ms_bucket{le="3000"}');
    expect(out).toContain('turn_latency_ms_bucket{le="4000"}');
  });

  it('SAD: a series with no samples yet still renders its TYPE header', () => {
    // Nothing incremented. A scraper must still see the metric declared,
    // otherwise "no calls yet" and "the counter was deleted" are the same
    // observation — which is how a total outage hides.
    const out = registry.expose();
    expect(out).toContain('# TYPE calls_total counter');
    expect(out).toContain('# TYPE webhook_signature_failures_total counter');
    expect(out).not.toMatch(/^calls_total\{/m);
  });
});
