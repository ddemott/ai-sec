import { describe, it, expect } from 'vitest';
import { formatPayRangeDisplay, normalizePayRange } from '../../shared/payRange';

describe('normalizePayRange', () => {
  it('SAD: spoken thousands become a compact $k range', () => {
    // WHO: owner reading a job lead captured from a live call
    // WHAT: "one forty to one hundred and sixty thousand" must not stay as words
    // WHY: TODO 2026-07-21 wrap-up — salary stored verbatim; dashboard/email
    //      need a normalized form alongside the caller's words
    expect(normalizePayRange('one forty to one hundred and sixty thousand')).toBe('$140–160k');
  });

  it('HAPPY: already-normalized ranges pass through', () => {
    expect(normalizePayRange('$65-82/hr')).toBe('$65–82/hr');
    expect(normalizePayRange('$180k-200k')).toBe('$180–200k');
  });

  it('SAD: unparseable copy stays null so the UI keeps verbatim only', () => {
    expect(normalizePayRange('competitive')).toBeNull();
    expect(normalizePayRange('')).toBeNull();
  });
});

describe('formatPayRangeDisplay', () => {
  it('HAPPY: shows $k then the caller words in parentheses', () => {
    expect(formatPayRangeDisplay('one forty to one hundred and sixty thousand')).toBe(
      '$140–160k (one forty to one hundred and sixty thousand)'
    );
  });

  it('SAD: unparseable returns the original string unchanged', () => {
    expect(formatPayRangeDisplay('competitive')).toBe('competitive');
  });
});
