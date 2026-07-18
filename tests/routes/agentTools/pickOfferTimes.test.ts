/**
 * WHO : pickOfferTimes — the times the agent OFFERS out loud.
 * WHAT: earliest-first, stepped by the SERVICE duration, walking only OPEN
 *       times; never more than three; the full open_times grid stays the
 *       membership authority alongside.
 * WHEN: every get_available_slots response with a non-empty day.
 * WHERE: src/routes/agentTools/helpers.ts, consumed by the available-slots
 *       route (offer_times + the spoken sentence).
 * WHY : Dale's spec from the 2026-07-17 evening call — the model's own sample
 *       spread first/middle/last ("1:00, 2:45, or 4:30"), which callers heard
 *       as arbitrary jumps, rattled off too fast to tell apart. Offers are now
 *       computed server-side (the model does no arithmetic) as consecutive
 *       meeting-length steps, and the route's note mandates one comma-paced
 *       sentence.
 */
import { describe, it, expect } from 'vitest';
import { pickOfferTimes } from '../../../src/routes/agentTools/helpers';

/** Build the parallel arrays the route builds: a 15-min grid over [from, to). */
function grid(fromMin: number, toMin: number, duration: number): [number[], string[]] {
  const mins: number[] = [];
  const labels: string[] = [];
  for (let t = fromMin; t + duration <= toMin; t += 15) {
    mins.push(t);
    const h24 = Math.floor(t / 60);
    const m = t % 60;
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    labels.push(`${h}:${String(m).padStart(2, '0')} ${ampm}`);
  }
  return [mins, labels];
}

describe('pickOfferTimes — duration-stepped offers from the OPEN list', () => {
  it('HAPPY: a wide-open afternoon offers consecutive meeting-length steps', () => {
    const [mins, labels] = grid(13 * 60, 17 * 60, 30); // 1:00–5:00, 30-min service
    expect(pickOfferTimes(mins, labels, 30)).toEqual(['1:00 PM', '1:30 PM', '2:00 PM']);
  });

  it('HAPPY: the step is the DURATION, not a hardcoded 30 — a 60-min service offers hourly', () => {
    const [mins, labels] = grid(13 * 60, 17 * 60, 60);
    expect(pickOfferTimes(mins, labels, 60)).toEqual(['1:00 PM', '2:00 PM', '3:00 PM']);
  });

  it('SAD: a booked 1:00–1:30 shifts the offers to the first REAL opening (Dale: "that\'s assuming those times are open")', () => {
    // Open list starts at 1:30 because [1:00,1:30) is subtracted upstream.
    const [mins, labels] = grid(13 * 60 + 30, 17 * 60, 30);
    expect(pickOfferTimes(mins, labels, 30)).toEqual(['1:30 PM', '2:00 PM', '2:30 PM']);
  });

  it('SAD: a booked block MID-afternoon is skipped to the next open time at or past the step', () => {
    // Open: 1:00–2:00 and 3:00–5:00 (2:00–3:00 booked upstream). 30-min steps:
    // 1:00 → next eligible 1:30 → next eligible 2:00 is NOT open, first open
    // ≥2:00 is 3:00.
    const g1 = grid(13 * 60, 14 * 60, 30);
    const g2 = grid(15 * 60, 17 * 60, 30);
    const mins = [...g1[0], ...g2[0]];
    const labels = [...g1[1], ...g2[1]];
    expect(pickOfferTimes(mins, labels, 30)).toEqual(['1:00 PM', '1:30 PM', '3:00 PM']);
  });

  it('SAD: fewer than three open steps → offer what exists, never invent', () => {
    const [mins, labels] = grid(16 * 60, 17 * 60, 30); // 4:00–5:00 only
    expect(pickOfferTimes(mins, labels, 30)).toEqual(['4:00 PM', '4:30 PM']);
    expect(pickOfferTimes([], [], 30)).toEqual([]);
  });
});
