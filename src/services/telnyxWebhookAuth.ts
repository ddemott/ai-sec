/**
 * Telnyx webhook signature verification.
 *
 * WHY THIS EXISTS (and why it is not optional on a mutating webhook):
 *
 * A Telnyx webhook is a PUBLIC HTTPS endpoint — Telnyx isn't logged in, so it
 * can't present a JWT, which is why these routes sit in PUBLIC_ROUTES. That
 * means anyone on the internet can POST JSON to them. The `from` phone number
 * in an inbound-SMS payload is therefore just *a string in the request body*:
 * in a forged request no handset, SIM, or carrier was ever involved, so nothing
 * vouches for it.
 *
 * Without verification, an inbound-SMS route is not "an SMS handler" — it is an
 * unauthenticated public API whose contract is "mutate state on behalf of any
 * phone number you name". Both inputs are guessable (the `to` number is the
 * business's public phone number; `from` numbers are just customer numbers), so
 * a forged POST costs nothing and sends no text.
 *
 * The signature is what turns "the from-number is attacker-supplied" into "the
 * from-number came from Telnyx, who got it from the carrier". Telnyx HMACs
 * `timestamp|rawBody` with a secret only they and we hold; a forger can write
 * any payload but cannot produce a valid signature for it.
 *
 * Two rules the callers must honor:
 *   1. Verify BEFORE parsing/acting on the payload — an unsigned caller must
 *      never reach the DB path.
 *   2. Verify against the EXACT bytes received (`req.rawBody`), never a
 *      re-stringified `req.body` — key order and whitespace need not survive a
 *      parse/serialize round-trip, and Telnyx signed the original bytes.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export type TelnyxSignatureResult =
  | { valid: true }
  | { valid: false; reason: 'missing_raw_body' | 'missing_signature' | 'signature_mismatch' };

/**
 * Verify a Telnyx `telnyx-signature` header against the raw request bytes.
 *
 * Header shape: `t=<unix-ts>,v1=<hex-hmac>`; the signed message is
 * `${timestamp}|${rawBody}` under HMAC-SHA256.
 *
 * Comparison is constant-time (timingSafeEqual) so a byte-by-byte timing oracle
 * can't be used to forge a signature one nibble at a time. Length is checked
 * first because timingSafeEqual throws on a length mismatch.
 */
export function verifyTelnyxSignature(params: {
  rawBody: Buffer | string | undefined;
  signatureHeader: string | undefined;
  secret: string;
}): TelnyxSignatureResult {
  const { rawBody, signatureHeader, secret } = params;

  const raw =
    typeof rawBody === 'string'
      ? rawBody
      : rawBody instanceof Buffer
        ? rawBody.toString('utf8')
        : null;
  if (raw === null) return { valid: false, reason: 'missing_raw_body' };

  if (!signatureHeader) return { valid: false, reason: 'missing_signature' };

  const parts = Object.fromEntries(
    signatureHeader
      .split(',')
      .map((p) => p.split('=') as [string, string])
      .filter((p) => p.length === 2)
  );
  const timestamp = parts['t'] ?? '';
  const receivedHex = parts['v1'] ?? '';
  if (!timestamp || !receivedHex) return { valid: false, reason: 'missing_signature' };

  const expectedHex = createHmac('sha256', secret).update(`${timestamp}|${raw}`).digest('hex');

  const received = Buffer.from(receivedHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  // Length check first: timingSafeEqual THROWS on differing lengths, so a
  // garbage-length signature would 500 instead of cleanly 403ing.
  if (received.length !== expected.length) return { valid: false, reason: 'signature_mismatch' };
  if (!timingSafeEqual(received, expected)) return { valid: false, reason: 'signature_mismatch' };

  return { valid: true };
}

// Keyword classification lives in ./smsKeywords — the ONE source of truth shared
// with ConsentService. Re-exported here so existing importers of this module keep
// working. Duplicating the word lists is exactly how the webhook and the consent
// service came to disagree about what START means (see PR #238).
export {
  classifySmsKeyword,
  OPT_OUT_WORDS,
  OPT_IN_WORDS,
  isOptOutKeyword,
  type SmsKeyword,
} from './smsKeywords';
