/**
 * Telnyx Messaging API wrapper. Single fetch, no SDK — matches the pattern
 * established in supabase/functions/vapi-tools/core/service.ts (owner SMS
 * notifications) so the edge function can be retired in Phase 2 without a
 * behavior change.
 *
 * TELNYX_API_KEY must be present in the environment; absence is treated as
 * a send-failure rather than an exception so fire-and-forget callers don't
 * need to branch.
 *
 * THIS IS A CHOKEPOINT — instrument HERE, not at the call sites. Six routes
 * send through this function (OTP codes, page-owner, take-message, the
 * self-service link, the outcome follow-up), and until 2026-07-13 not one of
 * them incremented a metric. `sms_sends_total` was wired only into SMSService,
 * the OTHER send path, so a systematically broken Telnyx number could fail
 * every OTP on the platform and `/metrics` would read 0/0 — indistinguishable
 * from "no one called". That is the precise failure the counter was created to
 * catch (see metrics.ts), and the counter could not see it.
 */
import { randomInt } from 'node:crypto';
import { smsSendsTotal, errorsTotal } from './metrics';

export interface TelnyxSmsResult {
  ok: boolean;
  error?: string;
  status?: number;
}

/**
 * Cap on a single Telnyx request.
 *
 * WHY IT MUST EXIST: this fetch had no timeout. The reminder worker sends
 * through the sibling adapter, guards its tick with an `isRunning` flag, and
 * processes reminders sequentially — so ONE hung TCP connection to Telnyx pins
 * `isRunning = true` forever, every later tick returns early, and all reminders
 * plus the demo-tenant cleanup stop dead. Silently. `/health` stays green,
 * because the process is perfectly alive; it is just waiting for a socket that
 * will never answer. 10s is far beyond Telnyx's normal sub-second response.
 */
const SEND_TIMEOUT_MS = 10_000;

export async function sendSms(params: {
  from: string;
  to: string;
  body: string;
}): Promise<TelnyxSmsResult> {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    // A missing credential is a send failure like any other, and it is exactly
    // the kind that reads as silence rather than as an error.
    smsSendsTotal.inc({ provider: 'telnyx', outcome: 'failed', reason: 'not_configured' });
    errorsTotal.inc({ event: 'sms_send_failed', provider: 'telnyx', reason: 'not_configured' });
    return { ok: false, error: 'TELNYX_API_KEY not configured' };
  }

  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: params.from,
        to: params.to,
        text: params.body,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      smsSendsTotal.inc({ provider: 'telnyx', outcome: 'failed', reason: `http_${res.status}` });
      errorsTotal.inc({
        event: 'sms_send_failed',
        provider: 'telnyx',
        reason: `http_${res.status}`,
      });
      return { ok: false, status: res.status, error: errBody || `HTTP ${res.status}` };
    }
    smsSendsTotal.inc({ provider: 'telnyx', outcome: 'sent' });
    return { ok: true, status: res.status };
  } catch (err) {
    // AbortSignal.timeout rejects with a TimeoutError — surface it distinctly.
    // "Telnyx is hanging" and "Telnyx rejected us" demand opposite responses.
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    smsSendsTotal.inc({
      provider: 'telnyx',
      outcome: 'failed',
      reason: timedOut ? 'timeout' : 'network',
    });
    errorsTotal.inc({
      event: 'sms_send_failed',
      provider: 'telnyx',
      reason: timedOut ? 'timeout' : 'network',
    });
    return {
      ok: false,
      error: timedOut
        ? `Telnyx did not respond within ${SEND_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : 'Unknown fetch error',
    };
  }
}

/**
 * Generates a zero-padded numeric verification code of the requested length.
 * Uses crypto for unbiased randomness (Math.random is biased across ranges).
 */
export function generateVerificationCode(digits = 6): string {
  const max = 10 ** digits;
  const n = randomInt(0, max);
  return n.toString().padStart(digits, '0');
}
