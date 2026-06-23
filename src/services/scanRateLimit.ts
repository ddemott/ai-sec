/**
 * Per-tenant website-scan rate limiter — token bucket.
 *
 * WHY this exists. `POST /knowledge/import-website` fetches an external URL
 * (up to 6 pages) and then runs an OpenAI extraction over the scraped text.
 * That's the single most expensive + abuse-prone request a tenant can make:
 * unbounded, it burns OpenAI budget and lets a tenant hammer arbitrary
 * external sites through our IP. The global `@fastify/rate-limit` plugin only
 * bounds per-IP request rate, not per-tenant scan cost — a tenant behind a
 * shared NAT or making slow, spaced calls slips right past it.
 *
 * This module fronts the scan with a per-tenant token bucket so one tenant
 * can only scan a few times an hour, and a noisy tenant only slows itself.
 *
 * Defaults: capacity 3 (a small burst — onboarding owners legitimately scan
 * their site a couple times while tuning), refilling 3 tokens/hour (≈ one new
 * scan every 20 minutes once the burst is spent). Both env-tunable.
 *
 * WHAT happens when the bucket runs dry: `tryAcquire()` returns false and the
 * route returns HTTP 429 (the canonical "wait and retry" status), the same
 * convention `src/routes/demo.ts` uses for its per-IP guard.
 *
 * This is the SECOND in-process token-bucket consumer (after
 * `src/services/communications/smsRateLimit.ts`). Per the repo's "extract a
 * shared shape after the third or fourth real consumer" rule, it deliberately
 * stays a small standalone copy rather than a premature abstraction — and it
 * keeps scan limits decoupled from the SMS env vars.
 *
 * Origin: docs/TODO.md "Website scan polish — rate-limit / per-tenant scan
 * guardrails." 2026-06-22.
 */

/** Per-tenant bucket state. Lives in-process (single Node event loop). */
interface BucketState {
  /** Current token count (fractional during refill calculation). */
  tokens: number;
  /** Wall-clock ms of the last time we recomputed tokens. */
  lastRefill: number;
}

export interface ScanRateLimitConfig {
  /** Max tokens (= max burst size). Default 3. */
  capacity: number;
  /** Tokens refilled per second. Default 3/3600 (3 per hour). */
  refillRate: number;
}

const DEFAULT_CAPACITY = parseInt(process.env.WEBSITE_SCAN_RATE_CAPACITY ?? '3', 10);
const DEFAULT_REFILL_PER_HOUR = parseFloat(process.env.WEBSITE_SCAN_RATE_REFILL_PER_HOUR ?? '3');

/**
 * Token-bucket rate limiter, per tenant. One instance is shared across the
 * process (the exported `scanRateLimiter` singleton); tests construct fresh
 * instances or call `reset()` for isolation.
 */
export class ScanRateLimiter {
  private buckets = new Map<string, BucketState>();
  private config: ScanRateLimitConfig;

  constructor(config?: Partial<ScanRateLimitConfig>) {
    this.config = {
      capacity: config?.capacity ?? DEFAULT_CAPACITY,
      refillRate: config?.refillRate ?? DEFAULT_REFILL_PER_HOUR / 3600,
    };
  }

  /**
   * Try to consume one token for the given tenant. Returns true if a token
   * was available (request allowed), false if the bucket was empty (reject
   * with 429). Refills lazily based on elapsed wall-clock time.
   *
   * `now` is injectable so tests can step the clock deterministically.
   */
  tryAcquire(tenantId: string, now: number = Date.now()): boolean {
    const bucket = this.getOrCreate(tenantId, now);
    this.refill(bucket, now);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /**
   * Current token count for a tenant. Useful in tests + observability;
   * the production path uses tryAcquire.
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
      // A new tenant starts with a full bucket so a first scan isn't
      // immediately rate-limited.
      bucket = { tokens: this.config.capacity, lastRefill: now };
      this.buckets.set(tenantId, bucket);
    }
    return bucket;
  }

  private refill(bucket: BucketState, now: number): void {
    if (now <= bucket.lastRefill) return; // clock didn't advance
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      this.config.capacity,
      bucket.tokens + elapsedSec * this.config.refillRate
    );
    bucket.lastRefill = now;
  }
}

/**
 * Shared singleton used by the website-scan route in production. Tests should
 * call `.reset()` in a beforeEach (or construct their own instance) for
 * isolation.
 */
export const scanRateLimiter = new ScanRateLimiter();
