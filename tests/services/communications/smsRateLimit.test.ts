/**
 * Unit tests for the per-tenant SMS rate limiter (token bucket).
 *
 * These tests inject a fixed `now` to make refill math deterministic —
 * real wall-clock time would race the assertion delay.
 */
import { describe, it, expect } from 'vitest';
import { SmsRateLimiter, RateLimitedError } from '../../../src/services/communications/smsRateLimit';

describe('SmsRateLimiter — token bucket per tenant', () => {
  it('HAPPY: a fresh tenant starts with a full bucket', () => {
    // WHO   : SMSService on the first send for a tenant
    // WHAT  : new bucket has `capacity` tokens, allows up to `capacity` immediate sends
    // WHEN  : tenant's first SMS after process boot
    // WHERE : SmsRateLimiter.getOrCreate — initial token count = capacity
    // WHY   : a tenant that just signed up shouldn't hit the rate limit
    //         on their first burst. Starting full lets small bursts fire
    //         immediately and only sustained traffic feel the bucket.
    const rl = new SmsRateLimiter({ capacity: 5, refillRate: 1 });
    expect(rl.getTokens('tenant-a', 1000)).toBe(5);
  });

  it('HAPPY: consecutive acquires drain the bucket; the Nth fails when N > capacity', () => {
    // WHY: pins the core bounding behavior. capacity=3 allows 3 sends
    //      then rate-limits. If capacity were silently capped at 1 or
    //      uncapped, this test fails immediately.
    const rl = new SmsRateLimiter({ capacity: 3, refillRate: 1 });
    const NOW = 1000;
    rl.acquire('t', NOW); // 1st send: token 3 → 2
    rl.acquire('t', NOW); // 2nd send: token 2 → 1
    rl.acquire('t', NOW); // 3rd send: token 1 → 0
    expect(() => rl.acquire('t', NOW)).toThrow(RateLimitedError);
  });

  it('HAPPY: bucket refills at refillRate tokens/sec over wall-clock time', () => {
    // WHO   : SMSService doing a steady-state send rate
    // WHAT  : after N seconds, the bucket holds N * refillRate more tokens (capped)
    // WHY   : pins the leak-bucket refill math. refillRate=2 means 2
    //         tokens added per second; after 1s of waiting, we expect
    //         (starting tokens) + 2.
    const rl = new SmsRateLimiter({ capacity: 10, refillRate: 2 });
    // Drain the bucket
    for (let i = 0; i < 10; i++) rl.acquire('t', 0);
    expect(rl.getTokens('t', 0)).toBeCloseTo(0, 5);
    // 1 second later → 2 tokens refilled
    expect(rl.getTokens('t', 1000)).toBeCloseTo(2, 5);
    // 5 seconds later → 10 tokens refilled, but capped at capacity=10
    expect(rl.getTokens('t', 5000)).toBe(10);
  });

  it('HAPPY: capacity is the upper bound — bucket never exceeds it', () => {
    // WHY: tenants that send nothing for a long time mustn't accumulate
    //      an unbounded burst budget. capacity=60 means at most 60
    //      messages can fire before the sustained rate kicks in.
    const rl = new SmsRateLimiter({ capacity: 60, refillRate: 1 });
    // Far-future time — should still be capped at capacity
    expect(rl.getTokens('quiet-tenant', 24 * 60 * 60 * 1000)).toBe(60);
  });

  it('SAD: RateLimitedError reports retryAfterMs based on refill rate', () => {
    // WHY: the error carries the time until the bucket can fulfill the
    //      request. The caller's retry logic (or HTTP client) can use
    //      this directly to schedule the next attempt. Pin the math:
    //      refillRate=1/sec → next token in 1000ms.
    const rl = new SmsRateLimiter({ capacity: 1, refillRate: 1 });
    rl.acquire('t', 0); // drains the bucket
    try {
      rl.acquire('t', 0);
      expect.fail('expected RateLimitedError');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitedError);
      const err = e as RateLimitedError;
      expect(err.status).toBe(429);
      expect(err.tenantId).toBe('t');
      // 1 token at 1/sec rate = 1000ms retry
      expect(err.retryAfterMs).toBeGreaterThan(0);
      expect(err.retryAfterMs).toBeLessThanOrEqual(1000);
    }
  });

  it('CONTRACT: separate tenants have independent buckets', () => {
    // WHY: this is the load-bearing claim of the whole feature — a
    //      noisy tenant must NOT throttle a quiet one. Without per-
    //      tenant isolation we'd be no better off than the SMS provider's
    //      account-wide rate limit.
    const rl = new SmsRateLimiter({ capacity: 2, refillRate: 1 });
    rl.acquire('tenant-noisy', 0);
    rl.acquire('tenant-noisy', 0);
    expect(() => rl.acquire('tenant-noisy', 0)).toThrow(RateLimitedError);

    // Quiet tenant still has a full bucket
    expect(rl.getTokens('tenant-quiet', 0)).toBe(2);
    expect(() => rl.acquire('tenant-quiet', 0)).not.toThrow();
    expect(() => rl.acquire('tenant-quiet', 0)).not.toThrow();
  });

  it('HAPPY: tryAcquire returns boolean instead of throwing', () => {
    // WHY: some call sites prefer a boolean to a try/catch. Pin both
    //      shapes work — tryAcquire returns true on success, false on
    //      rate limit, and doesn't bubble RateLimitedError.
    const rl = new SmsRateLimiter({ capacity: 1, refillRate: 1 });
    expect(rl.tryAcquire('t', 0)).toBe(true);
    expect(rl.tryAcquire('t', 0)).toBe(false);
  });

  it('HAPPY: reset() clears all buckets — used by tests for isolation', () => {
    // WHY: the singleton smsRateLimiter is shared across the process;
    //      tests need a way to start from a known state without
    //      constructing a fresh limiter each time.
    const rl = new SmsRateLimiter({ capacity: 2, refillRate: 1 });
    rl.acquire('t', 0);
    rl.acquire('t', 0);
    expect(rl.getTokens('t', 0)).toBe(0);
    rl.reset();
    // After reset, the bucket is recreated full on next access
    expect(rl.getTokens('t', 0)).toBe(2);
  });

  it('CONTRACT: clock moving backwards does not refill the bucket', () => {
    // WHY: defense in depth against system clock adjustments (NTP
    //      sync, daylight savings boundary in some clock libs). If
    //      now < lastRefill, refill should be a no-op rather than
    //      either crashing or somehow adding negative tokens.
    const rl = new SmsRateLimiter({ capacity: 3, refillRate: 1 });
    rl.acquire('t', 5000); // bucket=2, lastRefill=5000
    rl.acquire('t', 5000); // bucket=1
    // "Now" is earlier than lastRefill — must not refill
    expect(rl.getTokens('t', 4000)).toBe(1);
  });
});
