/**
 * Retry policy for the reminder worker.
 *
 * Pure helpers — no DB, no provider calls. The worker
 * (src/workers/reminderScheduler.ts) calls these to decide:
 *   - Is this error worth retrying? (Twilio/email 5xx + network → yes;
 *     4xx → no, because the same input will produce the same error.)
 *   - When should the next attempt fire? (Exponential backoff:
 *     5 min, 30 min, 2 hours.)
 *   - Have we exhausted retries? (Cap at MAX_RETRIES = 3 total retry
 *     attempts → 4 total send attempts including the original.)
 *
 * Origin: docs/TODO.md — "Retry logic for failed sends." Pre-fix the
 * worker marked a reminder `status='failed'` on the first send error
 * and never retried, meaning a single transient Twilio 5xx or network
 * blip lost the reminder permanently. Added 2026-05-14 alongside
 * migration 20260514000000 (retry_count + next_retry_at columns).
 */

/**
 * Maximum retry attempts. After this many failures the worker flips
 * `status='failed'` permanently and stops retrying. 3 total retries
 * means 4 total send attempts (original + 3 retries) before giving up.
 */
export const MAX_RETRIES = 3;

/**
 * Backoff intervals in minutes. The index is "the retry attempt number
 * we're about to wait for" — so:
 *   BACKOFF_MIN[0] = 5  → 1st retry waits 5 minutes after the original failure
 *   BACKOFF_MIN[1] = 30 → 2nd retry waits 30 min after the 1st retry's failure
 *   BACKOFF_MIN[2] = 120 → 3rd retry waits 2 hours after the 2nd retry's failure
 *
 * Reads naturally as "after retry attempt N fails, wait BACKOFF_MIN[N]
 * minutes before trying retry attempt N+1" — though when called from
 * the worker we pass the current `retry_count` (which is N) and look
 * up the same slot.
 */
export const BACKOFF_MIN: readonly number[] = [5, 30, 120];

/**
 * Decide whether a send-attempt error is worth retrying. HTTP 4xx
 * errors describe a client-side problem (bad phone number format, opt-
 * out recipient, blocked content) — re-sending the same payload won't
 * help. HTTP 5xx + network errors describe transient provider/server
 * problems — retry could succeed without operator intervention.
 *
 * Recognized error shapes:
 *   - Twilio: throws an Error with `status: number` (the HTTP status).
 *   - Generic HTTP: `statusCode: number` is the common Node/Fastify shape.
 *   - Fetch errors / generic Error: no status field present → treat as
 *     retryable (conservative — better to over-retry than lose).
 */
export function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true;
  const e = error as { status?: number; statusCode?: number };
  const status = e.status ?? e.statusCode;
  if (typeof status !== 'number') return true; // no HTTP status info → retryable
  // 429 (Too Many Requests) is technically a 4xx but it's the canonical
  // "wait and retry later" signal — both Twilio's per-account throttle
  // and our own per-tenant SMS rate limiter
  // (src/services/communications/smsRateLimit.ts) emit it. Treating it
  // as retryable lets the existing 5m/30m/2h backoff naturally handle
  // bucket-refill timing.
  if (status === 429) return true;
  if (status >= 400 && status < 500) return false; // other 4xx → don't retry
  return true; // 5xx or anything else → retryable
}

/**
 * Compute the `next_retry_at` timestamp for a row that just failed.
 * `currentRetryCount` is the value of `retry_count` going INTO this
 * attempt (i.e. how many retries have already happened). Returns
 * the wall-clock time of when the next retry should fire, or `null`
 * if retries are exhausted (caller should flip status='failed' instead).
 *
 * `now` is injected so tests can pin the clock; default is real time.
 */
export function nextRetryAt(currentRetryCount: number, now: Date = new Date()): Date | null {
  if (currentRetryCount >= MAX_RETRIES) return null;
  const minutes = BACKOFF_MIN[currentRetryCount];
  if (minutes === undefined) return null; // defense in depth — should be unreachable
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * Top-level decision: given the error a send attempt threw and the
 * row's current retry_count, what should the worker do?
 *
 *   - 'retry'  → update retry_count + next_retry_at, keep status='scheduled'
 *   - 'fail'   → flip status='failed' permanently (4xx error OR exhausted retries)
 *
 * The worker handles the actual DB write — this function just returns
 * the disposition + the new field values for the 'retry' case.
 */
export type RetryDecision =
  | { action: 'retry'; nextRetryCount: number; nextRetryAt: Date }
  | { action: 'fail'; reason: 'non_retryable' | 'max_retries_exceeded' };

export function decideRetry(
  error: unknown,
  currentRetryCount: number,
  now: Date = new Date()
): RetryDecision {
  if (!isRetryable(error)) {
    return { action: 'fail', reason: 'non_retryable' };
  }
  const next = nextRetryAt(currentRetryCount, now);
  if (next === null) {
    return { action: 'fail', reason: 'max_retries_exceeded' };
  }
  return {
    action: 'retry',
    nextRetryCount: currentRetryCount + 1,
    nextRetryAt: next,
  };
}
