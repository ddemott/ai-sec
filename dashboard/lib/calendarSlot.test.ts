/**
 * Tests for isSlotOnFifteenMinuteGrid — the guard that prevents an
 * AppointmentView slot click from opening the create form when the
 * picked time isn't on the 15-minute grid (e.g. user zoomed to 5-min
 * slots and clicked :05).
 */
import { describe, it, expect } from 'vitest';

import { isSlotOnFifteenMinuteGrid } from './calendarSlot';

function dt(h: number, m: number, s = 0, ms = 0): Date {
  const d = new Date(2026, 5, 15, h, m, s, ms);
  return d;
}

describe('isSlotOnFifteenMinuteGrid', () => {
  it.each([
    [{ start: dt(14, 0), end: dt(14, 30) }, '14:00 → 14:30'],
    [{ start: dt(14, 15), end: dt(14, 45) }, '14:15 → 14:45'],
    [{ start: dt(14, 30), end: dt(15, 0) }, '14:30 → 15:00'],
    [{ start: dt(14, 45), end: dt(15, 15) }, '14:45 → 15:15'],
  ])('HAPPY: %s on grid', (slot) => {
    // WHO: react-big-calendar slot click at zoom levels 60/30/15
    // WHAT: both endpoints on :00/:15/:30/:45 → guard returns true,
    //        caller forwards to parent's onSelectSlot
    // WHERE: AppointmentView onSelectSlot wrapper before form-open
    expect(isSlotOnFifteenMinuteGrid(slot)).toBe(true);
  });

  it.each([
    [{ start: dt(14, 5), end: dt(14, 35) }, '14:05 — 5-min zoom click'],
    [{ start: dt(14, 10), end: dt(14, 40) }, '14:10 — 10-min zoom click'],
    [{ start: dt(14, 0), end: dt(14, 23) }, '14:00 → 14:23 — drag end off-grid'],
    [{ start: dt(14, 7), end: dt(14, 22) }, ':07 + :22 both off'],
  ])('SAD: %s off grid', (slot) => {
    // WHO: operator zoomed to 10-min or 5-min and click-dragged a slot
    // WHAT: at least one endpoint is off-grid → guard returns false,
    //        caller skips form-open and shows the increment toast
    // WHY: pre-guard, the form would open with off-grid prefilled times,
    //        operator fills in customer + service, hits Save, and only
    //        then sees the increment error from the JS validator. Wasted
    //        clicks. Front-end-only fix avoids any server roundtrip.
    expect(isSlotOnFifteenMinuteGrid(slot)).toBe(false);
  });

  it('SAD: sub-minute precision (start has seconds) is rejected', () => {
    // WHY: matches the DB CHECK constraint which requires
    //        EXTRACT(SECOND FROM start_time) = 0
    expect(isSlotOnFifteenMinuteGrid({ start: dt(14, 0, 30), end: dt(14, 30) })).toBe(false);
  });

  it('SAD: sub-second precision (start has milliseconds) is rejected', () => {
    expect(isSlotOnFifteenMinuteGrid({ start: dt(14, 0, 0, 500), end: dt(14, 30) })).toBe(false);
  });
});
