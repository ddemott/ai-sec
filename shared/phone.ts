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

export function isValidPhone(phone: string | undefined | null): boolean {
  return normalizePhone(phone) !== null;
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
