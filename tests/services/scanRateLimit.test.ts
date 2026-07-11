/**
 * WHO:   ScanRateLimiter — per-tenant token bucket fronting the website scan
 * WHAT:  caps burst + sustained scan rate per tenant; over-limit → tryAcquire false
 * WHEN:  every POST /knowledge/import-website (the expensive fetch + LLM path)
 * WHERE: src/services/scanRateLimit.ts
 * WHY:   the scan is the costliest tenant request; without a per-tenant cap one
 *        tenant can burn OpenAI budget + proxy-abuse external sites. These tests
 *        pin the burst size, the per-tenant isolation, and the time-based refill.
 *
 * The clock is injected (`now` arg) so refill is deterministic — no real waiting.
 */
import { describe, it, expect } from 'vitest';
import { ScanRateLimiter } from '../../src/services/scanRateLimit';

describe('ScanRateLimiter', () => {
  it('HAPPY: allows up to the burst capacity, then rejects', () => {
    // WHAT: capacity 3 → first 3 acquires succeed, 4th fails (clock frozen)
    const rl = new ScanRateLimiter({ capacity: 3, refillRate: 0 });
    const t = 1_000_000;
    expect(rl.tryAcquire('tenant-a', t)).toBe(true);
    expect(rl.tryAcquire('tenant-a', t)).toBe(true);
    expect(rl.tryAcquire('tenant-a', t)).toBe(true);
    expect(rl.tryAcquire('tenant-a', t)).toBe(false);
  });

  it('HAPPY: buckets are per-tenant — one tenant draining does not block another', () => {
    // WHY: a noisy tenant must only slow ITSELF; isolation is the whole point
    const rl = new ScanRateLimiter({ capacity: 1, refillRate: 0 });
    const t = 1_000_000;
    expect(rl.tryAcquire('tenant-a', t)).toBe(true);
    expect(rl.tryAcquire('tenant-a', t)).toBe(false); // a is now dry
    expect(rl.tryAcquire('tenant-b', t)).toBe(true); // b is untouched
  });

  it('HAPPY: refills over time at the configured rate', () => {
    // WHAT: capacity 3, refill 1 token/sec. Drain, then advance 2s → 2 tokens back
    const rl = new ScanRateLimiter({ capacity: 3, refillRate: 1 });
    const t0 = 1_000_000;
    // Drain the bucket.
    expect(rl.tryAcquire('tenant-a', t0)).toBe(true);
    expect(rl.tryAcquire('tenant-a', t0)).toBe(true);
    expect(rl.tryAcquire('tenant-a', t0)).toBe(true);
    expect(rl.tryAcquire('tenant-a', t0)).toBe(false);
    // Advance 2 seconds → ~2 tokens refilled.
    const t2 = t0 + 2000;
    expect(rl.tryAcquire('tenant-a', t2)).toBe(true);
    expect(rl.tryAcquire('tenant-a', t2)).toBe(true);
    expect(rl.tryAcquire('tenant-a', t2)).toBe(false);
  });

  it('HAPPY: refill never exceeds capacity (no token hoarding while idle)', () => {
    // WHY: a long-idle tenant shouldn't accumulate a giant burst allowance
    const rl = new ScanRateLimiter({ capacity: 2, refillRate: 1 });
    const t0 = 1_000_000;
    // Idle for an hour with a full bucket → still capped at capacity.
    expect(rl.getTokens('tenant-a', t0 + 3_600_000)).toBe(2);
    expect(rl.tryAcquire('tenant-a', t0 + 3_600_000)).toBe(true);
    expect(rl.tryAcquire('tenant-a', t0 + 3_600_000)).toBe(true);
    expect(rl.tryAcquire('tenant-a', t0 + 3_600_000)).toBe(false);
  });

  it('HAPPY: reset() clears all buckets (test-isolation hook)', () => {
    const rl = new ScanRateLimiter({ capacity: 1, refillRate: 0 });
    const t = 1_000_000;
    expect(rl.tryAcquire('tenant-a', t)).toBe(true);
    expect(rl.tryAcquire('tenant-a', t)).toBe(false);
    rl.reset();
    expect(rl.tryAcquire('tenant-a', t)).toBe(true); // bucket is full again
  });

  it('HAPPY: default config gives a 3-scan burst (per-hour refill)', () => {
    // WHAT: the production defaults — capacity 3, refill 3/hour. A fresh tenant
    //        gets 3 immediate scans then is throttled within the same minute.
    const rl = new ScanRateLimiter();
    const t = 1_000_000;
    expect(rl.tryAcquire('t', t)).toBe(true);
    expect(rl.tryAcquire('t', t)).toBe(true);
    expect(rl.tryAcquire('t', t)).toBe(true);
    expect(rl.tryAcquire('t', t)).toBe(false);
    // One minute later, far less than the ~20min/token refill → still throttled.
    expect(rl.tryAcquire('t', t + 60_000)).toBe(false);
  });
});
