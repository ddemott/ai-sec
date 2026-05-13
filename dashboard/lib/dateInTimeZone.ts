/**
 * Tenant-timezone-aware calendar-date helpers for the scheduler.
 *
 * Why this exists: SchedulerDateNav previously computed today/yesterday/
 * tomorrow using `new Date()` + `getFullYear/getMonth/getDate` — values
 * resolved in BROWSER local time. A super-admin in Los Angeles viewing a
 * Chicago tenant's schedule at 11pm PST saw "Today = Mar 4" highlighted
 * when the tenant was already in Mar 5. Real bug, real source of
 * dashboard-vs-reality confusion in support sessions.
 *
 * These helpers ask `Intl.DateTimeFormat` for the calendar date in the
 * tenant's IANA timezone, comparing tuples of (year, month, day) rather
 * than UTC instants. Output Date objects use noon UTC on the target day,
 * which renders correctly in any browser timezone less than 12h different
 * from the tenant — covering every operator-on-the-same-continent case.
 * The pathological >=12h-offset case (e.g., HST admin viewing a Sydney
 * tenant) may still mismatch by a calendar day in places where the
 * downstream code calls `Date.getDate()` directly; documented as a
 * follow-up (`useSchedulerData.toDateString` is the principal offender).
 */

export interface CalendarDate {
    year: number;
    month: number; // 1-12
    day: number;   // 1-31
}

/**
 * Extract the calendar date of `date` as observed in `timeZone`. The IANA
 * timezone (`America/Chicago`, `Asia/Tokyo`, etc.) decides what "today"
 * means for this comparison.
 */
export function getCalendarDateInTimeZone(date: Date, timeZone: string): CalendarDate {
    // en-CA's date format is YYYY-MM-DD which is the cleanest to parse, but
    // we don't even use the formatted string — we ask formatToParts so each
    // component is already separated and locale-independent.
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const year = Number(parts.find((p) => p.type === 'year')?.value);
    const month = Number(parts.find((p) => p.type === 'month')?.value);
    const day = Number(parts.find((p) => p.type === 'day')?.value);
    return { year, month, day };
}

/**
 * True when `a` and `b` fall on the same calendar date in the given
 * timezone. Strictly stronger than comparing UTC instants: two appointments
 * 3 hours apart can be on different calendar days for a tenant whose
 * timezone happens to cross midnight between them.
 */
export function isSameDayInTimeZone(a: Date, b: Date, timeZone: string): boolean {
    const ca = getCalendarDateInTimeZone(a, timeZone);
    const cb = getCalendarDateInTimeZone(b, timeZone);
    return ca.year === cb.year && ca.month === cb.month && ca.day === cb.day;
}

/**
 * Construct a Date object representing noon UTC on `calendarDate`'s day.
 * Used by the scheduler's date-nav chips: clicking "Tomorrow" calls
 * `onDateChange(makeNoonUtcDateFromCalendar(tomorrowInTZ))`, and downstream
 * code that reads `.getDate()` in browser TZ still sees the correct day-of-
 * month as long as the offset is <12h (which it is for any browser/tenant
 * pair on the same continent).
 */
export function makeNoonUtcDateFromCalendar(c: CalendarDate): Date {
    // Date.UTC(y, m, d) takes 0-indexed month — convert.
    return new Date(Date.UTC(c.year, c.month - 1, c.day, 12, 0, 0));
}

/**
 * Today / yesterday / tomorrow as calendar tuples in the given timezone.
 * Anchored at `now` so tests can inject a fixed system clock without
 * depending on vi.useFakeTimers leaking across spec files.
 */
export function relativeCalendarDays(now: Date, timeZone: string): {
    today: CalendarDate;
    yesterday: CalendarDate;
    tomorrow: CalendarDate;
} {
    const today = getCalendarDateInTimeZone(now, timeZone);

    // To get yesterday/tomorrow, add ±24h to `now` (a UTC instant) and ask
    // for the calendar date IN tenantTZ. This Just Works across DST
    // transitions because the +24h shift is on the UTC axis; the formatter
    // applies the timezone's DST rules per-instant.
    const yesterdayInstant = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tomorrowInstant = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    return {
        today,
        yesterday: getCalendarDateInTimeZone(yesterdayInstant, timeZone),
        tomorrow: getCalendarDateInTimeZone(tomorrowInstant, timeZone),
    };
}
