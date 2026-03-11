export function formatPhone(raw?: string | null): string {
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (!digits) return raw

  // Handle US numbers (10 or 11 digits)
  let normalized = digits
  if (digits.length === 11 && digits.startsWith('1')) {
    normalized = digits.slice(1)
  } else if (digits.length === 11 && !digits.startsWith('1')) {
    // International or invalid US, return as-is with +
    return `+${digits}`
  }

  if (normalized.length === 10) {
    const area = normalized.slice(0, 3)
    const prefix = normalized.slice(3, 6)
    const line = normalized.slice(6)
    return `+1 (${area}) ${prefix}-${line}`
  }

  // If not standard US, return with leading + if not present
  return raw.startsWith('+') ? raw : `+${digits}`
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
