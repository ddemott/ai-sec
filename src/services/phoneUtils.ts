/**
 * Phone number normalization shared between the Fastify backend and
 * the LiveKit agent worker. Ported from supabase/functions/vapi-tools/
 * core/dispatcher.ts (2026-04-01 length-validation fix preserved).
 *
 * Rules:
 *   10 digits              → prepend +1 (US without country code)
 *   11+ digits, leads w/ 1 → prepend +
 *   already has +          → pass through
 *   < 10 digits            → null (invalid — prevents "+1" being accepted)
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
