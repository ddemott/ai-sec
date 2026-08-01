/**
 * WHO: the caller who names a time that is not on offer.
 * WHAT: explainRequestedTime classifies WHY, from the same intervals that built
 *       the offer list; spokenReason/reasonNote turn that into a sentence the
 *       agent relays and an instruction it follows.
 * WHEN: every available-slots call that carries requested_time.
 * WHERE: src/services/availabilityReason.ts.
 * WHY: membership answers only WHETHER. On 2026-07-27 (SCL_VcKTTgo4kS2v,
 *      CALL_IMPROVEMENTS.md #8) a caller asked for 2:30, her OWN appointment
 *      was sitting on it, and the model — given a list with a hole in it and no
 *      reason — invented "we can only book on the quarter hour". 2:30 is a
 *      quarter hour. A model with no reason will manufacture one.
 */
import { describe, expect, it } from 'vitest';

import {
  explainRequestedTime,
  formatMinutesOfDay,
  parseRequestedTime,
  reasonNote,
  spokenReason,
  type BookedInterval,
} from '../../src/services/availabilityReason';

const at = (h: number, m = 0): number => h * 60 + m;
/** 1 PM–5 PM shift, the Thinking Hammer shape. */
const SHIFT = [{ start: at(13), end: at(17) }];
const noBookings: BookedInterval[] = [];

const explain = (over: Partial<Parameters<typeof explainRequestedTime>[0]> = {}) =>
  explainRequestedTime({
    requestedMinutes: at(14, 30),
    durationMinutes: 30,
    coverage: SHIFT,
    booked: noBookings,
    openMinutes: [at(13), at(13, 15), at(15), at(15, 15)],
    isToday: false,
    currentMinutes: 0,
    ...over,
  });

describe('explainRequestedTime', () => {
  it('THE LIVE BUG: the caller\'s OWN appointment is named as the reason', () => {
    const r = explain({
      booked: [{ start: at(14, 30), end: at(15), isCaller: true }],
    });
    expect(r.verdict).toBe('occupied_by_caller');
    expect(r.conflictStart).toBe(at(14, 30));
    expect(spokenReason(r, '2:30 PM')).toBe('You already have an appointment at 2:30 PM.');
    // And it must steer to keep/move — never to a silent second booking.
    expect(reasonNote(r)).toMatch(/keep it, move it/i);
  });

  it("someone else's booking is 'already spoken for' — never described, never named", () => {
    const r = explain({ booked: [{ start: at(14, 30), end: at(15), isCaller: false }] });
    expect(r.verdict).toBe('occupied');
    const spoken = spokenReason(r, '2:30 PM')!;
    expect(spoken).toBe('2:30 PM is already spoken for.');
    // Another customer's schedule is that customer's business.
    expect(reasonNote(r)).toMatch(/never name or describe/i);
  });

  it('the CALLER\'S own booking outranks a stranger\'s when both overlap', () => {
    // Two bookings can straddle one requested slot (different employees). The
    // caller's own is both the truer answer and the one that prevents a double.
    const r = explain({
      booked: [
        { start: at(14, 15), end: at(14, 45), isCaller: false },
        { start: at(14, 30), end: at(15), isCaller: true },
      ],
    });
    expect(r.verdict).toBe('occupied_by_caller');
    expect(r.conflictStart).toBe(at(14, 30));
  });

  it('a booking that merely ABUTS the request does not occupy it (half-open overlap)', () => {
    // 2:00–2:30 ends exactly when 2:30 starts: no overlap, so the reason is
    // whatever else is true — here, on-shift with no room in the list.
    const r = explain({ booked: [{ start: at(14), end: at(14, 30), isCaller: true }] });
    expect(r.verdict).not.toBe('occupied_by_caller');
    expect(r.verdict).not.toBe('occupied');
  });

  it('outside the shift window → outside_shift, not "taken"', () => {
    const r = explain({ requestedMinutes: at(9) });
    expect(r.verdict).toBe('outside_shift');
    expect(spokenReason(r, '9:00 AM')).toMatch(/not open/i);
  });

  it('nobody scheduled at all that day → closed', () => {
    const r = explain({ coverage: [], openMinutes: [] });
    expect(r.verdict).toBe('closed');
    expect(spokenReason(r, '2:30 PM')).toBe("We're closed that day.");
  });

  it('earlier today → past (and only when it IS today)', () => {
    const past = explain({
      requestedMinutes: at(13, 30),
      isToday: true,
      currentMinutes: at(14),
      openMinutes: [at(15)],
    });
    expect(past.verdict).toBe('past');
    // Same clock time on a FUTURE day is not past.
    const future = explain({
      requestedMinutes: at(13, 30),
      isToday: false,
      currentMinutes: at(14),
      openMinutes: [at(15)],
    });
    expect(future.verdict).not.toBe('past');
  });

  it('on shift, unbooked, but the service does not fit → no_room', () => {
    // 4:45 PM start, 30-minute service, shift ends 5:00 PM.
    const r = explain({ requestedMinutes: at(16, 45), openMinutes: [at(13)] });
    expect(r.verdict).toBe('no_room');
    expect(spokenReason(r, '4:45 PM')).toMatch(/isn't enough time/i);
  });

  it('THE LIST IS THE AUTHORITY ON YES — a time in open_times is available, always', () => {
    // Even with a booking that looks overlapping, membership wins: the list is
    // what booking will accept, and a reason that contradicts it would recreate
    // the 2026-07-14 bug (refusing a slot that was wide open).
    const r = explain({
      requestedMinutes: at(15),
      booked: [{ start: at(15), end: at(15, 30), isCaller: true }],
    });
    expect(r.verdict).toBe('available');
    expect(spokenReason(r, '3:00 PM')).toBeNull();
    expect(reasonNote(r)).toMatch(/book it/i);
  });
});

describe('parseRequestedTime', () => {
  it('accepts the shapes a model actually sends', () => {
    expect(parseRequestedTime('2:30 PM')).toBe(at(14, 30));
    expect(parseRequestedTime('2:30pm')).toBe(at(14, 30));
    expect(parseRequestedTime('2 PM')).toBe(at(14));
    expect(parseRequestedTime('14:30')).toBe(at(14, 30));
    expect(parseRequestedTime('9am')).toBe(at(9));
    expect(parseRequestedTime('12:00 AM')).toBe(0);
    expect(parseRequestedTime('12 PM')).toBe(at(12));
  });

  it('refuses anything it cannot read — a guess here becomes a wrong answer aloud', () => {
    for (const bad of ['', 'sometime', 'half two', '25:00', '2:70 PM', '13 PM', null, undefined]) {
      expect(parseRequestedTime(bad as string)).toBeNull();
    }
  });
});

describe('formatMinutesOfDay', () => {
  it('renders the same shape open_times uses', () => {
    expect(formatMinutesOfDay(at(14, 30))).toBe('2:30 PM');
    expect(formatMinutesOfDay(at(13))).toBe('1:00 PM');
    expect(formatMinutesOfDay(0)).toBe('12:00 AM');
    expect(formatMinutesOfDay(at(12))).toBe('12:00 PM');
  });
});
