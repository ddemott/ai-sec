/**
 * Name utilities — canonical implementation in shared/.
 * Used for CRM sync (split incoming full names), display, and slug generation.
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

/**
 * The business name as a PERSON would say it — legal suffix stripped from the
 * final token ("Thinking Hammer LLC" → "Thinking Hammer").
 *
 * MIRRORS `speakableName()` in agent/src/greeting.ts, which is the SOURCE OF
 * TRUTH the voice agent actually speaks with. The agent package deploys
 * standalone and does not import from /shared, so the implementation lives in
 * both places — keep them in sync (same suffix set, same last-token-only
 * rule). This copy exists so the DASHBOARD can preview exactly what the agent
 * will say (Caller Disclosure default preview): showing "Thinking Hammer LLC"
 * when the agent says "Thinking Hammer" is a false preview.
 *
 * Only the LAST token is considered, so a suffix-like word that is genuinely
 * part of the name survives ("Incorporated Designs" → kept whole). A business
 * literally named "LLC" is returned unchanged — something odd beats nothing.
 */
const LEGAL_NAME_SUFFIXES = new Set([
  'llc',
  'inc',
  'incorporated',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'co',
  'company',
  'plc',
  'llp',
  'lp',
  'pllc',
  'pc',
]);

export function speakableBusinessName(name: string | null | undefined): string {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) return trimmed;
  const m = /^(.*?)[\s,]+([A-Za-z.]+)$/.exec(trimmed);
  if (!m) return trimmed;
  const [, head, lastToken] = m;
  const normalised = lastToken.replace(/\./g, '').toLowerCase();
  if (!LEGAL_NAME_SUFFIXES.has(normalised)) return trimmed;
  const spoken = head.replace(/[\s,]+$/, '').trim();
  return spoken || trimmed;
}
