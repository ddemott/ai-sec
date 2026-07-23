/**
 * Phone number utilities — canonical implementation in shared/ so backend,
 * dashboard, and agent worker stay in sync.
 *
 * Rules for normalizePhone (strict E.164, used for storage + lookups):
 *   10 digits              → prepend +1 (US without country code)
 *   11+ digits, leads w/ 1 → prepend +
 *   already has +          → pass through
 *   < 10 digits            → null (invalid — prevents "+1" being accepted)
 *
 * formatPhone is for human display only: +1 (555) 555-0001 style.
 */

export function normalizePhone(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return phone.startsWith('+') ? phone : `+${digits}`;
}

/**
 * Type predicate, not a plain boolean: `if (!isValidPhone(p)) return;` narrows
 * `p` to `string` for the rest of the block. Same runtime behavior — it just
 * tells the compiler what the check already proved, so callers stop needing a
 * cast to pass a validated number on.
 */
export function isValidPhone(phone: string | undefined | null): phone is string {
  return normalizePhone(phone) !== null;
}

/**
 * Would transferring to `forwardPhone` loop the call straight back into the
 * assistant? Two shapes, both fatal on a live call:
 *
 *   1. forwardPhone === forwardedFromPhone — the transfer rings the very line
 *      that forwards INTO the assistant, so the carrier forwards it right back.
 *   2. forwardPhone === inboundPhone — the transfer dials the assistant's own
 *      number.
 *
 * THE BUG THIS FIXES: the 20260629 migration split `forward_phone` from
 * `forwarded_from_phone` and said in its own comment they were kept distinct
 * "so the two can't be the same number and loop the call back to the AI" — and
 * then NOTHING EVER COMPARED THEM. No code, no CHECK constraint. The rule was
 * written down and the enforcement was not.
 *
 * Compares NORMALIZED numbers on purpose: "+16082175303" and "(608) 217-5303"
 * are one line, and a raw string compare passes the guard and dials the loop.
 *
 * **Forwarding IN is NOT itself disqualifying.** A tenant may forward from a
 * home line and transfer to a shop line — two different numbers, no loop, a
 * perfectly good setup. Only SAMENESS is the problem. A blanket
 * "forwarding on → no transfer" rule would break that tenant (Dale,
 * 2026-07-23).
 */
export function isTransferLoop(
  forwardPhone: string | null | undefined,
  forwardedFromPhone: string | null | undefined,
  inboundPhone?: string | null
): boolean {
  const target = normalizePhone(forwardPhone);
  // Nothing configured is not a loop — it is simply no transfer. Callers
  // distinguish the two via canTransfer() below.
  if (!target) return false;
  return [forwardedFromPhone, inboundPhone].some((other) => {
    const n = normalizePhone(other);
    return n !== null && n === target;
  });
}

/**
 * Can this tenant actually transfer a live call to a human?
 *
 * The SINGLE resolved capability. Computed server-side and handed to the agent
 * as one boolean so the prompt never re-derives the rule from raw phone numbers
 * and cannot drift away from it. Every "can we transfer?" decision — greeting
 * opt-out, tool gating, the script's unavailable line — reads this one answer.
 */
export function canTransfer(
  forwardPhone: string | null | undefined,
  forwardedFromPhone: string | null | undefined,
  inboundPhone?: string | null
): boolean {
  return (
    normalizePhone(forwardPhone) !== null &&
    !isTransferLoop(forwardPhone, forwardedFromPhone, inboundPhone)
  );
}

/**
 * Formats a phone number for display.
 * Returns pretty US format when possible, otherwise falls back to +E.164 style.
 */
export function formatPhone(raw?: string | null): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return raw;

  // Handle US numbers (10 or 11 digits)
  let normalized = digits;
  if (digits.length === 11 && digits.startsWith('1')) {
    normalized = digits.slice(1);
  } else if (digits.length === 11 && !digits.startsWith('1')) {
    // International or invalid US, return as-is with +
    return `+${digits}`;
  }

  if (normalized.length === 10) {
    const area = normalized.slice(0, 3);
    const prefix = normalized.slice(3, 6);
    const line = normalized.slice(6);
    return `+1 (${area}) ${prefix}-${line}`;
  }

  // If not standard US, return with leading + if not present
  return raw.startsWith('+') ? raw : `+${digits}`;
}
