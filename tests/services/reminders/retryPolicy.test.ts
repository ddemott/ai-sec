/**
 * Unit tests for the reminder retry policy.
 *
 * These cover the pure helpers (no DB, no provider calls) so the
 * behavior is locked in deterministically. The companion real-DB test
 * in `src/reminder-retry-worker.test.ts` exercises the worker → DB
 * write path against an actual Postgres instance.
 */
import { describe, it, expect } from 'vitest';
import { BACKOFF_MIN, MAX_RETRIES, decideRetry, isRetryable, nextRetryAt } from '../../../src/services/reminders/retryPolicy';

describe('isRetryable', () => {
  it('HAPPY: returns true for a 5xx error (transient provider issue)', () => {
    // WHO   : worker catch block — the SMS provider threw a 503 Service Unavailable
    // WHAT  : isRetryable inspects the error's HTTP status field
    // WHEN  : every send-attempt failure
    // WHERE : retryPolicy.isRetryable
    // WHY   : 5xx errors describe transient problems; retrying could
    //         succeed without operator intervention. The 4xx case is
    //         the inverse and is pinned below.
    expect(isRetryable({ status: 503 })).toBe(true);
    expect(isRetryable({ status: 500 })).toBe(true);
    expect(isRetryable({ statusCode: 502 })).toBe(true);
  });

  it('SAD: returns false for any 4xx error (client-side, will never succeed)', () => {
    // WHY: a 4xx means the input is broken (bad phone number, blocked
    //      recipient, etc.) — re-sending the same payload won't help.
    //      Marking failed immediately avoids burning retry budget on
    //      a guaranteed-doomed input. Origin: docs/TODO.md retry-logic
    //      entry, explicit "Provider 4xx (invalid number, etc.) does
    //      not retry" line.
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable({ status: 404 })).toBe(false);
    expect(isRetryable({ status: 422 })).toBe(false);
    expect(isRetryable({ statusCode: 400 })).toBe(false);
    expect(isRetryable({ statusCode: 499 })).toBe(false);
  });

  it('HAPPY: 429 (Too Many Requests) is retryable despite being 4xx', () => {
    // WHO   : SMSService throws RateLimitedError when the per-tenant
    //         token bucket is dry; the SMS provider's account-wide throttle also
    //         returns 429.
    // WHAT  : isRetryable({status: 429}) → true (special-cased above
    //         the generic 4xx → false rule)
    // WHEN  : sustained-rate-exceeded send attempts
    // WHERE : retryPolicy.isRetryable — 429 carve-out
    // WHY   : 429 is HTTP's canonical "wait and retry" signal. Without
    //         this special case the reminder retry policy would mark
    //         the row failed immediately and we'd lose the message;
    //         worse, the per-tenant rate limit
    //         (src/services/communications/smsRateLimit.ts) is the
    //         primary path so this case fires under normal load, not
    //         just exotic provider errors.
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ statusCode: 429 })).toBe(true);
  });

  it('HAPPY: returns true for an error with no status field (conservative default)', () => {
    // WHY: network errors (DNS failure, connection refused) and generic
    //      thrown Errors have no HTTP status. We retry rather than fail —
    //      "better to over-retry than lose" per the policy comment.
    expect(isRetryable(new Error('ECONNREFUSED'))).toBe(true);
    expect(isRetryable({ message: 'timeout' })).toBe(true);
    expect(isRetryable(undefined)).toBe(true);
    expect(isRetryable(null)).toBe(true);
    expect(isRetryable('string error')).toBe(true);
  });

  it('EDGE: 3xx and 6xx (non-existent) status codes treated as retryable', () => {
    // WHY: only 4xx is non-retryable; anything else is either transient
    //      (5xx) or doesn't fit the HTTP error model at all. Belt-and-
    //      braces against future provider clients that abuse the status
    //      field (the SMS provider sometimes returns 0 for network errors).
    expect(isRetryable({ status: 300 })).toBe(true);
    expect(isRetryable({ status: 0 })).toBe(true);
    expect(isRetryable({ status: 600 })).toBe(true);
  });
});

describe('nextRetryAt', () => {
  // Pin the clock so the timestamp math is deterministic. Real wall
  // time would race the assertion-vs-call-site delay.
  const FIXED_NOW = new Date('2026-05-14T10:00:00.000Z');

  it('HAPPY: returns now + 5 min for retry_count=0 (first retry)', () => {
    // WHO   : worker on first send failure
    // WHAT  : nextRetryAt(0) → 5 minutes from now
    // WHEN  : right after the original attempt fails
    // WHERE : retryPolicy.nextRetryAt + BACKOFF_MIN[0]
    // WHY   : the policy spec is 5m / 30m / 2h. Pinning the first slot
    //         catches a regression that swaps the array order.
    const next = nextRetryAt(0, FIXED_NOW);
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe('2026-05-14T10:05:00.000Z');
  });

  it('HAPPY: returns now + 30 min for retry_count=1 (second retry)', () => {
    // WHY: pins BACKOFF_MIN[1] = 30. If someone "simplifies" the array
    //      to a constant interval, this fails immediately.
    const next = nextRetryAt(1, FIXED_NOW);
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe('2026-05-14T10:30:00.000Z');
  });

  it('HAPPY: returns now + 2 hours for retry_count=2 (third retry)', () => {
    // WHY: pins BACKOFF_MIN[2] = 120. The 2h cap matches typical SLA
    //      windows for transient provider issues — much longer and the
    //      reminder context (24h before appointment, etc.) goes stale.
    const next = nextRetryAt(2, FIXED_NOW);
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe('2026-05-14T12:00:00.000Z');
  });

  it('SAD: returns null for retry_count >= MAX_RETRIES (exhausted)', () => {
    // WHY: MAX_RETRIES = 3 means after 3 retries the row has had 4 total
    //      send attempts. The 4th failure → permanent fail. nextRetryAt
    //      returning null is the signal the worker uses to flip status.
    expect(nextRetryAt(3, FIXED_NOW)).toBeNull();
    expect(nextRetryAt(4, FIXED_NOW)).toBeNull();
    expect(nextRetryAt(100, FIXED_NOW)).toBeNull();
  });

  it('CONTRACT: BACKOFF_MIN.length === MAX_RETRIES', () => {
    // WHY: if someone bumps MAX_RETRIES without adding a backoff slot
    //      (or vice versa), nextRetryAt would silently return null for
    //      the new attempt. This invariant test fails loudly on either
    //      half of the mismatch.
    expect(BACKOFF_MIN.length).toBe(MAX_RETRIES);
  });
});

describe('decideRetry', () => {
  const FIXED_NOW = new Date('2026-05-14T10:00:00.000Z');

  it('HAPPY: 5xx error with retries available → retry decision with next_retry_at + retry_count+1', () => {
    // WHO   : worker calling decideRetry after a the SMS provider 503
    // WHAT  : { action: 'retry', nextRetryCount: 1, nextRetryAt: now+5m }
    // WHEN  : first send attempt fails transiently
    // WHERE : retryPolicy.decideRetry composing isRetryable + nextRetryAt
    // WHY   : single-call API for the worker; both halves of the
    //         decision (do we retry? when?) are computed atomically so
    //         the worker doesn't carry intermediate state.
    const d = decideRetry({ status: 503 }, 0, FIXED_NOW);
    expect(d.action).toBe('retry');
    if (d.action === 'retry') {
      expect(d.nextRetryCount).toBe(1);
      expect(d.nextRetryAt.toISOString()).toBe('2026-05-14T10:05:00.000Z');
    }
  });

  it('SAD: 4xx error → fail decision with reason=non_retryable, regardless of retry_count', () => {
    // WHY: pin the policy that 4xx skips the entire retry queue. Even
    //      with retry_count=0 (3 retries still available), a 4xx is
    //      "the input is broken; future retries will see the same
    //      input; don't waste cycles."
    const d = decideRetry({ status: 400 }, 0, FIXED_NOW);
    expect(d.action).toBe('fail');
    if (d.action === 'fail') {
      expect(d.reason).toBe('non_retryable');
    }
  });

  it('SAD: 5xx error at MAX_RETRIES → fail decision with reason=max_retries_exceeded', () => {
    // WHY: the row already burned all 3 retries; the 4th attempt's
    //      failure is the giving-up signal. Distinguishing the reason
    //      ('non_retryable' vs 'max_retries_exceeded') in the error
    //      message helps the operator diagnose flaky-provider issues
    //      vs malformed inputs.
    const d = decideRetry({ status: 503 }, 3, FIXED_NOW);
    expect(d.action).toBe('fail');
    if (d.action === 'fail') {
      expect(d.reason).toBe('max_retries_exceeded');
    }
  });

  it('HAPPY: network-style error (no status) → retry', () => {
    // WHY: ECONNREFUSED / DNS / timeout errors are exactly the kind of
    //      transient failure the retry policy was built for — pin that
    //      they're treated as retryable, not lost.
    const d = decideRetry(new Error('ECONNREFUSED'), 0, FIXED_NOW);
    expect(d.action).toBe('retry');
  });
});
