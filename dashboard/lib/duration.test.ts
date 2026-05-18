import { describe, it, expect } from 'vitest';
import { roundUpTo15 } from './duration';

describe('roundUpTo15', () => {
  it('leaves exact-snap values unchanged', () => {
    // WHO: every existing service today was a multiple of 15 (the seed
    //      defaults are 30/60/90/120). The rounding must be a no-op for
    //      those rows or the next save would silently move the value.
    // WHAT: pins identity for 15, 30, 45, 60, 75, 90.
    // WHERE: dashboard/lib/duration.ts
    // WHEN: any save path that runs an existing duration back through.
    // WHY: idempotency. A second call must equal the first.
    for (const v of [15, 30, 45, 60, 75, 90]) {
      expect(roundUpTo15(v)).toBe(v);
    }
  });

  it('rounds UP non-multiples (not nearest)', () => {
    // WHY: rounding DOWN would silently shrink a 22-min service to 15
    //      and the staff would feel rushed by a slot that's shorter
    //      than the customer was quoted. Up is the only safe direction.
    expect(roundUpTo15(1)).toBe(15);
    expect(roundUpTo15(14)).toBe(15);
    expect(roundUpTo15(16)).toBe(30);
    expect(roundUpTo15(22)).toBe(30);
    expect(roundUpTo15(46)).toBe(60);
    expect(roundUpTo15(89)).toBe(90);
  });

  it('returns 0 for non-positive, non-finite, or null/undefined input', () => {
    // WHY: the caller's "must be ≥ 1" upstream validation should have
    //      caught these, but a defensive zero is safer than NaN bleeding
    //      into the API request body where it'd 400 or worse. The
    //      undefined/null path matters for Partial<Service> form state
    //      where duration_minutes may not be set yet.
    expect(roundUpTo15(0)).toBe(0);
    expect(roundUpTo15(-5)).toBe(0);
    expect(roundUpTo15(NaN)).toBe(0);
    expect(roundUpTo15(Infinity)).toBe(0);
    expect(roundUpTo15(undefined)).toBe(0);
    expect(roundUpTo15(null)).toBe(0);
  });
});
