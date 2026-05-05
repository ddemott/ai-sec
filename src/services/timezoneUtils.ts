/**
 * Timezone utilities for voice-agent tool calls. Voice AI passes naive
 * datetime strings (no offset); the backend must interpret them in the
 * tenant's IANA timezone before handing the value to Postgres.
 *
 * Origin: ported from `supabase/functions/vapi-tools/core/dispatcher.ts`
 * during the LiveKit migration (commit `661d21d`, 2026-04-27).
 *
 * DST audit (2026-05-05): the previous `applyTimezone` looked up the
 * tenant offset by treating the naive string as UTC and asking
 * `Intl.DateTimeFormat` for the offset at that UTC instant. That's
 * correct most of the day, but during the ~6-hour window between a
 * local DST transition and UTC catching up, the wall-clock view in the
 * tenant zone has already changed offset while the UTC-view hasn't, so
 * the function returned the pre-transition offset for naive times that
 * the user meant in the post-transition offset. Concretely:
 *   "2026-03-08T05:30:00" + "America/Chicago"  → returned "-06:00",
 *   should be "-05:00" (DST started at 2am local on Mar 8 → 5:30am is
 *   already CDT). Result: every booking made via voice during that
 *   window landed at the wrong UTC instant, off by exactly one hour.
 *
 * Fix: a single fixed-point iteration. Compute the candidate offset
 * (naive-as-UTC view), use it to derive the *real* UTC instant the
 * user meant, then re-ask the formatter for the offset at that real
 * instant. On non-transition days the two offsets agree and the
 * iteration is a no-op; on transition days the second answer wins.
 */

export function hasTimezone(dt: string): boolean {
  return /Z$/i.test(dt) || /[+-]\d{2}:\d{2}$/.test(dt) || /[+-]\d{4}$/.test(dt);
}

/**
 * Look up the UTC offset that a given IANA zone is in at a specific
 * UTC instant. Returns minutes east of UTC (Chicago summer = -300),
 * or null if the zone string is unrecognized / the formatter doesn't
 * surface a parsable shortOffset.
 */
function offsetMinutesAt(instant: Date, ianaTimezone: string): number | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: ianaTimezone,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(instant);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    if (!tzPart) return null;
    if (tzPart.value === 'GMT' || tzPart.value === 'UTC') return 0;
    const match = tzPart.value.match(/GMT([+-]?)(\d{1,2})(?::(\d{2}))?/);
    if (!match) return null;
    const sign = match[1] === '-' ? -1 : 1;
    const hours = parseInt(match[2], 10);
    const minutes = parseInt(match[3] || '0', 10);
    return sign * (hours * 60 + minutes);
  } catch {
    return null;
  }
}

/** Format a signed minute offset as RFC3339 "+HH:MM" / "-HH:MM". */
function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60).toString().padStart(2, '0');
  const m = (abs % 60).toString().padStart(2, '0');
  return `${sign}${h}:${m}`;
}

/**
 * Attach the tenant's UTC offset to a naive datetime string. If the
 * string already has timezone info it's returned unchanged. Resolves
 * DST transitions correctly via fixed-point iteration (see file header).
 * Falls back to a month-based America/Chicago heuristic if the IANA
 * zone is unrecognized — voice AI must not crash mid-call on a config
 * typo.
 */
export function applyTimezone(dt: string, ianaTimezone: string): string {
  if (!dt) return dt;
  if (hasTimezone(dt)) return dt;

  const naive = new Date(dt + 'Z');
  if (isNaN(naive.getTime())) return dt;

  // First guess: offset valid at "naive interpreted as UTC". This is
  // wrong inside the post-DST-transition window, but it gets us close
  // enough to find the right answer in one more step.
  const guess = offsetMinutesAt(naive, ianaTimezone);
  if (guess === null) {
    // Unknown zone — preserve the legacy month-based fallback so a
    // typo'd config doesn't hang up a live caller. Documented + tested.
    const monthMatch = dt.match(/^\d{4}-(\d{2})/);
    if (monthMatch) {
      const month = parseInt(monthMatch[1], 10);
      return dt + (month >= 3 && month <= 10 ? '-05:00' : '-06:00');
    }
    return dt + '-05:00';
  }

  // Translate the naive wall-clock to the real UTC instant under that
  // first-guess offset, then re-ask the zone for the offset at THAT
  // instant. On transition days this snaps to the post-transition
  // offset; on every other day the two answers are identical.
  const realInstant = new Date(naive.getTime() - guess * 60_000);
  const refined = offsetMinutesAt(realInstant, ianaTimezone);
  return dt + formatOffset(refined ?? guess);
}
