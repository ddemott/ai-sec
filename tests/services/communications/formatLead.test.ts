/**
 * Lead-time humanizer. Reminder leads used to be a closed set of whole hours
 * (72/24/2), so the SMS template could say `in ${hours}h`. Callers can now pick
 * any lead, and 0.5 hours reads "in 0.5h" — not something a receptionist says.
 */
import { describe, it, expect } from 'vitest';
import { formatLeadTime } from '../../../src/services/communications/formatLead';

describe('formatLeadTime', () => {
  it('HAPPY: sub-hour leads read as minutes (the voice flow default)', () => {
    expect(formatLeadTime(30)).toBe('30 minutes');
    expect(formatLeadTime(1)).toBe('1 minute'); // singular
    expect(formatLeadTime(59)).toBe('59 minutes');
  });

  it('HAPPY: whole hours read as hours; ragged leads keep their remainder', () => {
    expect(formatLeadTime(60)).toBe('1 hour');
    expect(formatLeadTime(120)).toBe('2 hours');
    expect(formatLeadTime(90)).toBe('1 hour 30 minutes'); // don't round away what they chose
  });

  it('HAPPY: the legacy bundle leads still render sanely', () => {
    expect(formatLeadTime(1440)).toBe('1 day'); // 24h
    expect(formatLeadTime(4320)).toBe('3 days'); // 72h
  });

  it('SAD: a rounded remainder must CARRY, never print "1 day 24 hours"', () => {
    // WHO: any lead a minute short of a whole day boundary.
    // WHAT: 2879 = 2 days minus 1 minute. Rounding the remainder independently
    //        gave days=1 and remHours=round(23.98)=24 → "1 days 24 hours".
    // WHY: impossible output, and it would be READ ALOUD to a caller. Flagged by
    //       review on PR #241. Rounding to whole hours first makes the carry
    //       arithmetic instead of a special case.
    expect(formatLeadTime(2879)).toBe('2 days');
    expect(formatLeadTime(2880)).toBe('2 days');
    // Below a day there is no carry to make: 1439 min IS 23h59m, and saying so
    // is honest. The bug was only ever in the day-rollup branch.
    expect(formatLeadTime(1439)).toBe('23 hours 59 minutes');
  });

  it('SAD: a nonsense lead degrades to a sayable word, not NaN', () => {
    expect(formatLeadTime(0)).toBe('shortly');
    expect(formatLeadTime(-5)).toBe('shortly');
    expect(formatLeadTime(NaN)).toBe('shortly');
  });
});
