/**
 * Shared name parsing utilities for CRM sync services.
 */

export function splitName(name: string | null): { firstName: string; lastName: string } {
  if (!name) return { firstName: '', lastName: '' };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export function joinName(firstName?: string | null, lastName?: string | null): string {
  return [firstName, lastName].filter(Boolean).join(' ') || 'Customer';
}

/**
 * Slugify a name for storage: lowercase, trimmed, spaces replaced with dashes.
 * Used by skill and service creation flows.
 *
 * Example: "  Oil Change  " → "oil-change"
 */
export function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '-');
}

/**
 * Build a display name from first/last name parts.
 * Handles nulls, empties, and partial inputs gracefully.
 *
 * Examples:
 *   buildDisplayName('John', 'Smith') → 'John Smith'
 *   buildDisplayName('John', null) → 'John'
 *   buildDisplayName(null, null) → ''
 */
export function buildDisplayName(firstName?: string | null, lastName?: string | null): string {
  return [firstName, lastName].filter(Boolean).join(' ');
}
