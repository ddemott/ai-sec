/**
 * Tests for the pre-pickup DNS warm. The resolver is mocked — a unit test that
 * touched real DNS would measure the network, not the code, and the whole point
 * of this module is what happens when the resolver is SLOW.
 */
import { describe, it, expect, vi } from 'vitest';
import { callPathHosts, warmDns, slowOrFailed, DEFAULT_WARM_TIMEOUT_MS } from './dnsWarm.js';

describe('callPathHosts', () => {
  it('HAPPY: warms both media vendors plus the backend and LiveKit hosts', () => {
    // WHO: the worker prewarm hook, deciding what to resolve before a call lands.
    // WHAT: the two fixed vendor endpoints the plugins dial, plus whatever hosts
    //       BACKEND_URL / LIVEKIT_URL point at in this environment.
    // WHEN: process boot, before any job is accepted.
    // WHERE: agent/src/session/dnsWarm.ts.
    // WHY: these four are every hostname a call touches; resolving anything else
    //      spends the idle window on connections the caller never waits for.
    const hosts = callPathHosts({
      BACKEND_URL: 'https://localhost:4001',
      LIVEKIT_URL: 'wss://example.livekit.cloud',
    });

    expect(hosts).toContain('api.deepgram.com');
    expect(hosts).toContain('api.openai.com');
    expect(hosts).toContain('localhost');
    expect(hosts).toContain('example.livekit.cloud');
  });

  it('SAD: a malformed BACKEND_URL is dropped, not thrown', () => {
    // WHY: a warm is a head start. Failing worker boot over a typo in a URL that
    //      other code already validates would turn an optimization into an outage.
    const hosts = callPathHosts({ BACKEND_URL: 'not-a-url' });

    expect(hosts).toEqual(['api.deepgram.com', 'api.openai.com']);
  });

  it('dedupes when two env vars name the same host', () => {
    const hosts = callPathHosts({
      BACKEND_URL: 'https://localhost:4001',
      LIVEKIT_URL: 'wss://localhost:7880',
    });

    expect(hosts.filter((h) => h === 'localhost')).toHaveLength(1);
  });
});

describe('warmDns', () => {
  it('HAPPY: resolves every host and reports how long each took', async () => {
    // WHAT: the measurement IS the deliverable — an 11s lookup is the thing that
    //       put a caller in dead air, and a warm that hides the number teaches
    //       nobody anything.
    let clock = 0;
    const lookup = vi.fn(async () => {
      clock += 40;
      return { address: '10.0.0.1', family: 4 };
    });

    const results = await warmDns(['api.deepgram.com', 'api.openai.com'], {
      lookup,
      now: () => clock,
    });

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[0].host).toBe('api.deepgram.com');
    expect(results.every((r) => r.ms >= 0)).toBe(true);
  });

  it('SAD: a hanging resolver is capped, not awaited forever', async () => {
    // WHO: the WSL host resolver, which answers AAAA for api.deepgram.com in
    //      11 seconds (measured 2026-08-15).
    // WHY: prewarm must stay bounded. A resolver that never answers cannot be
    //      allowed to hold a worker process that a caller is waiting on.
    vi.useFakeTimers();
    try {
      const never: Promise<never> = new Promise(() => {});
      const promise = warmDns(['api.deepgram.com'], { lookup: () => never, timeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(60);
      const results = await promise;

      expect(results).toHaveLength(1);
      expect(results[0]?.ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('SAD: a rejecting lookup is swallowed — the call path resolves on its own', async () => {
    const results = await warmDns(['api.deepgram.com'], {
      lookup: () => Promise.reject(new Error('ENOTFOUND')),
    });

    expect(results[0]).toMatchObject({ host: 'api.deepgram.com', ok: false });
  });

  it('caps at 8s by default — longer than any healthy lookup, shorter than a call', () => {
    expect(DEFAULT_WARM_TIMEOUT_MS).toBe(8_000);
  });
});

describe('slowOrFailed', () => {
  it('flags the slow and the failed, ignores the fast', () => {
    // WHY: a 1s+ resolution in the idle process is the early warning for the
    //      exact 11s pause a caller heard on 2026-08-15.
    const flagged = slowOrFailed([
      { host: 'fast.example', ok: true, ms: 40 },
      { host: 'slow.example', ok: true, ms: 11_069 },
      { host: 'broken.example', ok: false, ms: 8_000 },
    ]);

    expect(flagged.map((r) => r.host)).toEqual(['slow.example', 'broken.example']);
  });
});
