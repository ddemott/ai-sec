/**
 * Utility functions shared across the dashboard
 */

/**
 * Converts a date to a local ISO string (YYYY-MM-DDTHH:mm) for datetime-local inputs
 */
export function toLocalISO(date: string | Date): string {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const tzOffset = d.getTimezoneOffset() * 60000;
  const localISO = new Date(d.getTime() - tzOffset).toISOString().slice(0, -1);
  return localISO;
}

/**
 * Ensures a date string is in full ISO format with timezone offset
 */
export function toISOStringWithOffset(value: string): string {
  if (!value) return value
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toISOString()
}

/**
 * Formats a customer's address parts into a single string
 */
export function formatCustomerAddress(customer: { address?: string; address_line2?: string; city?: string; state?: string; postal_code?: string } | undefined): string {
  if (!customer) return ''
  return [
    customer.address,
    customer.address_line2,
    customer.city,
    [customer.state, customer.postal_code].filter(Boolean).join(' ')
  ]
    .filter(Boolean)
    .join(', ')
}

/**
 * Extracts first and last name from a full name string
 */
export function splitFullName(fullName: string): { first: string; last: string } {
  if (!fullName) return { first: '', last: '' };
  const [first, ...rest] = fullName.trim().split(/\s+/);
  return {
    first: first || '',
    last: rest.join(' ') || ''
  };
}
