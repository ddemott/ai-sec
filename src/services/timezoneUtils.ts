/**
 * Timezone utilities for voice-agent tool calls. Ported from
 * supabase/functions/vapi-tools/core/dispatcher.ts.
 *
 * Voice AI passes naive datetime strings (no offset); the backend must
 * interpret them in the tenant's IANA timezone before handing to Postgres.
 */

export function hasTimezone(dt: string): boolean {
  return /Z$/i.test(dt) || /[+-]\d{2}:\d{2}$/.test(dt) || /[+-]\d{4}$/.test(dt);
}

/**
 * Attach the tenant's current UTC offset to a naive datetime string. If
 * the string already has timezone info it's returned unchanged. Uses
 * Intl.DateTimeFormat so DST transitions resolve correctly for the given
 * date. Falls back to America/Chicago (CDT/CST) if the IANA zone is
 * unrecognized.
 */
export function applyTimezone(dt: string, ianaTimezone: string): string {
  if (!dt) return dt;
  if (hasTimezone(dt)) return dt;

  const naive = new Date(dt + 'Z');
  if (isNaN(naive.getTime())) return dt;

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: ianaTimezone,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(naive);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    if (tzPart) {
      // UTC/GMT zones return just "GMT" with no digits; treat as +00:00.
      if (tzPart.value === 'GMT' || tzPart.value === 'UTC') {
        return dt + '+00:00';
      }
      const match = tzPart.value.match(/GMT([+-]?)(\d{1,2})(?::(\d{2}))?/);
      if (match) {
        const sign = match[1] === '-' ? '-' : '+';
        const hours = match[2].padStart(2, '0');
        const minutes = (match[3] || '00').padStart(2, '0');
        return dt + `${sign}${hours}:${minutes}`;
      }
    }
  } catch {
    // unknown zone — fall through to default
  }

  const monthMatch = dt.match(/^\d{4}-(\d{2})/);
  if (monthMatch) {
    const month = parseInt(monthMatch[1], 10);
    const offset = month >= 3 && month <= 10 ? '-05:00' : '-06:00';
    return dt + offset;
  }
  return dt + '-05:00';
}
