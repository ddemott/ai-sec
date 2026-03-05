export function formatPhone(raw?: string | null): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (!digits) return raw

  // Normalize to 10-digit US number, assuming leading 1 if 11 digits
  let normalized = digits
  if (digits.length === 11 && digits.startsWith('1')) {
    normalized = digits.slice(1)
  }

  if (normalized.length !== 10) {
    // If not a standard US length, just return original
    return raw
  }

  const area = normalized.slice(0, 3)
  const prefix = normalized.slice(3, 6)
  const line = normalized.slice(6)
  return `+1 (${area}) ${prefix}-${line}`
}

/**
 * Normalizes a phone number to E.164 format (+1XXXXXXXXXX)
 * Strips all non-digit characters and ensures a leading +1
 */
export function normalizePhone(raw?: string | null): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  
  // If already 11 digits and starts with 1, just add +
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }
  
  // If 10 digits, assume US and add +1
  if (digits.length === 10) {
    return `+1${digits}`
  }
  
  // Otherwise return digits as-is (might be international)
  return `+${digits}`
}
