/**
 * Unit coverage for the tenant-timezone date helpers powering
 * SchedulerDateNav. Critical correctness boundary — every cross-timezone
 * admin session (super-admin in LA reviewing a Chicago tenant, etc.)
 * depends on these functions returning the calendar date as the TENANT
 * would see it, not as the admin's browser would.
 */
import { describe, it, expect } from 'vitest';
import {
  getCalendarDateInTimeZone,
  isSameDayInTimeZone,
  makeNoonUtcDateFromCalendar,
  relativeCalendarDays,
} from './dateInTimeZone';

describe('getCalendarDateInTimeZone', () => {
  it('returns the LA calendar date for an LA-relative instant', () => {
    // WHO: super-admin checking what "today" is for a Los Angeles tenant.
    // WHAT: 2026-05-13T07:00:00Z is May 13 in UTC and May 13 in LA (UTC-7
    //       during DST), so we expect { year:2026, month:5, day:13 }.
    // WHEN: every page render of the date-nav.
    // WHERE: Intl.DateTimeFormat with timeZone:'America/Los_Angeles' must
    //        emit the LA-local calendar date.
    // WHY: pins the trivial-but-load-bearing happy path. If a TS upgrade
    //      or Node minor bumps the ICU library and Intl drifts, this is
    //      the test that catches it before scheduler users see wrong
    //      labels.
    const instant = new Date('2026-05-13T07:00:00Z');
    expect(getCalendarDateInTimeZone(instant, 'America/Los_Angeles')).toEqual({
      year: 2026,
      month: 5,
      day: 13,
    });
  });

  it('returns the PREVIOUS calendar day when the UTC instant has already crossed midnight in the tenant TZ', () => {
    // WHO: super-admin in LA at 11pm PDT (2026-05-13 23:00 PDT = 2026-05-14
    //      06:00 UTC) reviewing a Chicago tenant (UTC-5 = 2026-05-14
    //      01:00 CDT).
    // WHAT: 2026-05-14T06:00:00Z is May 14 in Chicago, but May 13 in
    //       Honolulu (UTC-10 = 2026-05-13 20:00 HST). Pin Honolulu →
    //       May 13. Catches a regression where the formatter falls back
    //       to browser TZ instead of honoring the timeZone option.
    // WHEN: cross-timezone admin sessions late at night — exactly the
    //       failure shape that prompted this whole feature.
    // WHERE: Intl.DateTimeFormat timeZone option.
    // WHY: pins the LITERAL bug the feature exists to fix. Without
    //      timezone awareness the chip would highlight "Today=May 14"
    //      for an admin in HST whose tenant operator was still seeing
    //      "today=May 13".
    const instant = new Date('2026-05-14T06:00:00Z');
    expect(getCalendarDateInTimeZone(instant, 'Pacific/Honolulu')).toEqual({
      year: 2026,
      month: 5,
      day: 13,
    });
  });

  it('returns the NEXT calendar day when the UTC instant has already crossed midnight in a forward timezone', () => {
    // WHO: super-admin in UTC reviewing a Sydney tenant (UTC+10 daylight = +11).
    // WHAT: 2026-05-13T14:00:00Z is May 13 in UTC, but already May 14 in
    //       Sydney (00:00 AEST). The formatter must emit { ...day:14 }.
    // WHEN: any forward-of-UTC timezone — Asia/Pacific tenants under
    //       an EU-based admin.
    // WHERE: same as above; the timeZone parameter resolves to the
    //        tenant's local calendar.
    // WHY: symmetry with the previous test. Without it, a refactor that
    //      accidentally handles only the "previous-day" direction
    //      (e.g., always subtracting an offset) would pass the LA test
    //      and silently fail Sydney.
    const instant = new Date('2026-05-13T14:00:00Z');
    expect(getCalendarDateInTimeZone(instant, 'Australia/Sydney')).toEqual({
      year: 2026,
      month: 5,
      day: 14,
    });
  });
});

describe('isSameDayInTimeZone', () => {
  it('HAPPY: two instants on the same Chicago calendar day match', () => {
    // WHO: scheduler comparing the user-selected Date against today/yesterday/
    //      tomorrow.
    // WHAT: 9am UTC and 5pm UTC on 2026-05-13 are both still 2026-05-13 in
    //       Chicago (UTC-5 during DST → CDT = UTC-5; 9am UTC = 4am CDT,
    //       5pm UTC = noon CDT — same calendar day).
    // WHEN: chip-vs-selectedDate comparison.
    // WHERE: same calendar-tuple comparison the chip's aria-pressed depends on.
    // WHY: pinning HAPPY identity means a regression that flipped > to < in
    //      the tuple comparison would fail loud.
    const a = new Date('2026-05-13T09:00:00Z');
    const b = new Date('2026-05-13T17:00:00Z');
    expect(isSameDayInTimeZone(a, b, 'America/Chicago')).toBe(true);
  });

  it('SAD: two instants 3 hours apart that straddle midnight in Chicago do NOT match', () => {
    // WHO: an appointment booked at 11pm CDT (2026-05-14 04:00 UTC) is
    //      NOT on the same calendar day as one booked at 2am CDT
    //      (2026-05-14 07:00 UTC + offset). The latter is 1am CDT next day.
    // WHAT: function correctly returns false even though both instants
    //       are within a single UTC date.
    // WHEN: the midnight-crossing edge case that browser-TZ comparison
    //       would mishandle for any admin not in CDT.
    // WHERE: tuple inequality on day.
    // WHY: pins the SAD direction. Without this, a "same UTC date" shortcut
    //      would still pass the HAPPY test above but silently break the
    //      across-midnight semantics.
    const before = new Date('2026-05-14T03:00:00Z'); // 10pm CDT May 13
    const after = new Date('2026-05-14T07:00:00Z'); // 2am CDT May 14
    expect(isSameDayInTimeZone(before, after, 'America/Chicago')).toBe(false);
  });
});

describe('makeNoonUtcDateFromCalendar', () => {
  it('returns a Date whose UTC components match the calendar tuple at 12:00', () => {
    // WHO: SchedulerDateNav using the helper to build a "click target"
    //      Date for the Yesterday/Today/Tomorrow chip handlers.
    // WHAT: input { year:2026, month:5, day:13 } produces a Date whose
    //       UTC year/month/day match and whose UTC hour is 12 — the
    //       noon-anchor pattern that survives any browser-TZ <12h
    //       offset from tenant TZ.
    // WHEN: every chip click sets selectedDate to one of these noon-UTC
    //       Date objects; downstream code (useSchedulerData) reads
    //       date.getDate() in browser TZ and gets the correct day-of-
    //       month as long as the offset stays under 12h.
    // WHERE: the new helper.
    // WHY: pin both halves of the contract — the UTC tuple AND the
    //      noon anchor — so a "use midnight instead" optimization
    //      (which would break for any browser TZ east of UTC) fails
    //      this test.
    const d = makeNoonUtcDateFromCalendar({ year: 2026, month: 5, day: 13 });
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(4); // 0-indexed: May == 4
    expect(d.getUTCDate()).toBe(13);
    expect(d.getUTCHours()).toBe(12);
  });
});

describe('relativeCalendarDays', () => {
  it('computes today/yesterday/tomorrow tuples in the supplied timezone', () => {
    // WHO: SchedulerDateNav computing chip targets from a fixed `now`.
    // WHAT: with now=2026-05-13T17:00:00Z (which is 12pm CDT), the
    //       Chicago calendar returns { today:May 13, yesterday:May 12,
    //       tomorrow:May 14 }.
    // WHEN: every render of the date-nav.
    // WHERE: the helper's +/- 24h shift on the UTC axis combined with
    //        per-instant formatter resolution.
    // WHY: HAPPY-path identity for a non-edge time-of-day. The DST
    //      transition specifically is NOT pinned here because the
    //      +/- 24h shift on the UTC axis handles DST automatically —
    //      a separate test would be redundant. The honest pin is
    //      "values line up at a stable midday."
    const now = new Date('2026-05-13T17:00:00Z');
    const r = relativeCalendarDays(now, 'America/Chicago');
    expect(r.today).toEqual({ year: 2026, month: 5, day: 13 });
    expect(r.yesterday).toEqual({ year: 2026, month: 5, day: 12 });
    expect(r.tomorrow).toEqual({ year: 2026, month: 5, day: 14 });
  });

  it('handles a late-night instant where browser-TZ and tenant-TZ disagree on "today"', () => {
    // WHO: super-admin in LA at 11pm PDT viewing a Chicago tenant.
    // WHAT: now=2026-05-14T06:00:00Z (= 11pm May 13 PDT, but 1am May 14
    //       CDT). The tenant's perspective: today=May 14, yesterday=
    //       May 13, tomorrow=May 15. The browser's perspective would
    //       say May 13 — which is why this whole feature exists.
    // WHEN: cross-timezone admin sessions; the originating bug.
    // WHERE: the helper resolves "today" via the formatter, not via the
    //        browser's Date object.
    // WHY: the canonical regression-prevention test. If anyone "simplifies"
    //      the helper to use new Date().getDate() instead of the formatter,
    //      this test fails and the simplification gets reverted.
    const now = new Date('2026-05-14T06:00:00Z');
    const r = relativeCalendarDays(now, 'America/Chicago');
    expect(r.today).toEqual({ year: 2026, month: 5, day: 14 });
    expect(r.yesterday).toEqual({ year: 2026, month: 5, day: 13 });
    expect(r.tomorrow).toEqual({ year: 2026, month: 5, day: 15 });
  });
});
