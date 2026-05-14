/**
 * Per-tenant SMS rate limiter — token bucket.
 *
 * WHY this exists. Pre-fix the project relied entirely on Twilio's
 * account-wide throttle to bound SMS volume. A single tenant batching
 * 200 reminders at once could exhaust the Twilio per-second budget for
 * everyone else on the same account. This module fronts the SMS path
 * with a per-tenant bucket so a noisy tenant only slows itself down.
 *
 * Defaults match the TODO spec: 1 SMS/sec sustained, 60-token bucket
 * (so a burst of up to 60 messages is allowed, then the bucket refills
 * at the sustained rate). These are configurable via env vars for
 * tuning without code changes.
 *
 * WHAT happens when the bucket runs dry: `acquire()` throws an
 * `RateLimitedError` with `status: 429`. 429 is the canonical "wait
 * and retry" HTTP status; the reminder retry policy
 * (`src/services/reminders/retryPolicy.ts`) special-cases 429 as
 * retryable, so a rate-limited reminder send falls naturally into the
 * existing retry queue with the same 5m/30m/2h backoff. No new error
 * paths need plumbing.
 *
 * Origin: docs/TODO.md "Rate limiting for SMS sends." Closed 2026-05-14.
 */

/**
 * Error thrown when a tenant's bucket is empty. The `status: 429`
 * marker is deliberate so the existing `isRetryable` helper picks it
 * up as retryable (the bucket will refill before the retry fires).
 */
export class RateLimitedError extends Error {
  status = 429;
  constructor(public tenantId: string, public retryAfterMs: number) {
    super(`SMS rate limit reached for tenant ${tenantId}; retry after ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = 'RateLimitedError';
  }
}

/** Per-tenant bucket state. Lives in-process — see README in this file. */
interface BucketState {
  /** Current token count (fractional during refill calculation). */
  tokens: number;
  /** Wall-clock ms of the last time we recomputed tokens. */
  lastRefill: number;
}

export interface SmsRateLimitConfig {
  /** Max tokens (= max burst size). Default 60. */
  capacity: number;
  /** Tokens refilled per second. Default 1.0. */
  refillRate: number;
}

const DEFAULT_CAPACITY = parseInt(process.env.SMS_RATE_LIMIT_CAPACITY ?? '60', 10);
const DEFAULT_REFILL_RATE_PER_SEC = parseFloat(process.env.SMS_RATE_LIMIT_REFILL_PER_SEC ?? '1.0');

/**
 * Token-bucket rate limiter, per tenant. Single instance shared across
 * the SMSService for the process; tests construct fresh instances.
 */
export class SmsRateLimiter {
  private buckets = new Map<string, BucketState>();
  private config: SmsRateLimitConfig;

  constructor(config?: Partial<SmsRateLimitConfig>) {
    this.config = {
      capacity: config?.capacity ?? DEFAULT_CAPACITY,
      refillRate: config?.refillRate ?? DEFAULT_REFILL_RATE_PER_SEC,
    };
  }

  /**
   * Attempt to consume one token for the given tenant. Throws
   * RateLimitedError if the bucket is empty. Refills the bucket
   * lazily based on elapsed wall-clock time.
   *
   * `now` is injectable so tests can step the clock deterministically.
   */
  acquire(tenantId: string, now: number = Date.now()): void {
    const bucket = this.getOrCreate(tenantId, now);
    this.refill(bucket, now);

    if (bucket.tokens < 1) {
      // How long until the next whole token becomes available? At
      // refillRate tokens/sec, one token takes 1000/refillRate ms.
      const retryAfterMs = Math.ceil((1 - bucket.tokens) * (1000 / this.config.refillRate));
      throw new RateLimitedError(tenantId, retryAfterMs);
    }

    bucket.tokens -= 1;
  }

  /**
   * Non-throwing alternative for callers that prefer a boolean.
   * Returns true if a token was consumed, false if the bucket was empty.
   */
  tryAcquire(tenantId: string, now: number = Date.now()): boolean {
    try {
      this.acquire(tenantId, now);
      return true;
    } catch (e) {
      if (e instanceof RateLimitedError) return false;
      throw e;
    }
  }

  /**
   * Current token count for a tenant. Mostly useful in tests and
   * observability — production code path uses acquire/tryAcquire.
   */
  getTokens(tenantId: string, now: number = Date.now()): number {
    const bucket = this.getOrCreate(tenantId, now);
    this.refill(bucket, now);
    return bucket.tokens;
  }

  /** Reset all buckets — for tests. */
  reset(): void {
    this.buckets.clear();
  }

  private getOrCreate(tenantId: string, now: number): BucketState {
    let bucket = this.buckets.get(tenantId);
    if (!bucket) {
      // New tenant starts with a full bucket so a small first send
      // doesn't immediately rate-limit.
      bucket = { tokens: this.config.capacity, lastRefill: now };
      this.buckets.set(tenantId, bucket);
    }
    return bucket;
  }

  private refill(bucket: BucketState, now: number): void {
    if (now <= bucket.lastRefill) return; // clock didn't advance
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.config.capacity, bucket.tokens + elapsedSec * this.config.refillRate);
    bucket.lastRefill = now;
  }
}

/**
 * Shared singleton used by SMSService in production. Tests should
 * construct their own SmsRateLimiter instance for isolation.
 */
export const smsRateLimiter = new SmsRateLimiter();
