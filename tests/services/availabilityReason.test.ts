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
  parseRequestedTimeCandidates,
  resolveRequestedTime,
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

describe('off_grid — the quarter-hour sentence, said only when it is TRUE', () => {
  it('an off-grid request is named as such', () => {
    // The mirror image of the bug: "we book on the quarter hour" was a LIE
    // about 2:30 and is the TRUTH about 2:10.
    const r = explain({ requestedMinutes: at(14, 10), openMinutes: [at(13), at(15)] });
    expect(r.verdict).toBe('off_grid');
    expect(spokenReason(r, '2:10 PM')).toMatch(/quarter hour/i);
    expect(reasonNote(r)).toMatch(/only say this when the reason IS off_grid/i);
  });

  it("but an off-grid time sitting on the caller's own booking still reports the booking", () => {
    // Occupancy outranks the grid: what they need to hear is the meeting they
    // already have, not a lecture about scheduling granularity.
    const r = explain({
      requestedMinutes: at(14, 10),
      booked: [{ start: at(14), end: at(14, 30), isCaller: true }],
      openMinutes: [at(15)],
    });
    expect(r.verdict).toBe('occupied_by_caller');
    expect(r.conflictStart).toBe(at(14));
    // And it speaks the BOOKING's time, not the odd time they asked for.
    expect(spokenReason(r, '2:10 PM', formatMinutesOfDay(r.conflictStart!))).toBe(
      'You already have an appointment at 2:00 PM.'
    );
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
    // Unambiguous 24-hour values need no marker.
    expect(parseRequestedTime('16:45')).toBe(at(16, 45));
    expect(parseRequestedTime('13')).toBe(at(13));
  });

  it('a bare hour yields BOTH readings — the caller said something real, so do not discard it', () => {
    expect(parseRequestedTimeCandidates('2')).toEqual([at(2), at(14)]);
    expect(parseRequestedTimeCandidates('9:30')).toEqual([at(9, 30), at(21, 30)]);
    expect(parseRequestedTimeCandidates('12')).toEqual([0, at(12)]);
    // Unambiguous inputs still yield exactly one.
    expect(parseRequestedTimeCandidates('2 PM')).toEqual([at(14)]);
    expect(parseRequestedTimeCandidates('16:45')).toEqual([at(16, 45)]);
  });

  it('AMBIGUITY IS UNPARSEABLE for the single-value parser (no hours to lean on)', () => {
    // Review catch on #311: "2" parsed as 2:00 AM, so a caller who meant 2 PM
    // would have been told "we're not open at 2:00 AM" — a confident wrong
    // reason, which is the exact failure this whole batch exists to remove.
    for (const ambiguous of ['2', '9:30', '11', '12', '12:15']) {
      expect(parseRequestedTime(ambiguous), ambiguous).toBeNull();
    }
  });

  it('refuses anything it cannot read — a guess here becomes a wrong answer aloud', () => {
    for (const bad of ['', 'sometime', 'half two', '25:00', '2:70 PM', '13 PM', null, undefined]) {
      expect(parseRequestedTime(bad as string)).toBeNull();
    }
  });
});

describe('resolveRequestedTime — the OPEN HOURS settle what a bare hour meant', () => {
  it('"2" at a shop open 1-5 PM is 2 PM — nobody means 2 AM, and nothing was guessed', () => {
    // Dale's point (2026-07-31): refusing a bare "2" is over-correction. The
    // caller named a time; the day's shift coverage says which one it can be.
    expect(resolveRequestedTime(parseRequestedTimeCandidates('2'), SHIFT)).toBe(at(14));
    expect(resolveRequestedTime(parseRequestedTimeCandidates('4:30'), SHIFT)).toBe(at(16, 30));
  });

  it('an explicit time is never second-guessed by the hours', () => {
    // "2 AM" against a 1-5 PM shop stays 2 AM — and gets an honest
    // outside_shift answer. Reinterpreting what a caller plainly said would be
    // a new kind of lie.
    expect(resolveRequestedTime(parseRequestedTimeCandidates('2 AM'), SHIFT)).toBe(at(2));
  });

  it('when the hours cannot settle it, the answer is null — not a coin-flip', () => {
    // Open around the clock: both readings are live, so nothing is known.
    const allDay = [{ start: 0, end: 24 * 60 }];
    expect(resolveRequestedTime(parseRequestedTimeCandidates('2'), allDay)).toBeNull();
    // Closed all day: neither reading is in hours.
    expect(resolveRequestedTime(parseRequestedTimeCandidates('2'), [])).toBeNull();
    // Nothing parseable at all.
    expect(resolveRequestedTime(parseRequestedTimeCandidates('sometime'), SHIFT)).toBeNull();
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
