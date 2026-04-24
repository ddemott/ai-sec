/**
 * Telnyx Messaging API wrapper. Single fetch, no SDK — matches the pattern
 * established in supabase/functions/vapi-tools/core/service.ts (owner SMS
 * notifications) so the edge function can be retired in Phase 2 without a
 * behavior change.
 *
 * TELNYX_API_KEY must be present in the environment; absence is treated as
 * a send-failure rather than an exception so fire-and-forget callers don't
 * need to branch.
 */
import { randomInt } from 'node:crypto';

export interface TelnyxSmsResult {
  ok: boolean;
  error?: string;
  status?: number;
}

export async function sendSms(params: {
  from: string;
  to: string;
  body: string;
}): Promise<TelnyxSmsResult> {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
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
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: errBody || `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown fetch error',
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
