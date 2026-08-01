/**
 * WHO: the caller who corrects a mishearing by SPELLING it, and the caller who
 *      introduces herself as "Jaya from Connolly Systems".
 * WHAT: both utterances are cleaned at the record_answer seam, before they
 *       become stored state.
 * WHERE: agent/src/nameCleanup.ts.
 * WHY: both were stored verbatim on real calls. The spelled correction replaced
 *      a wrong name with a differently wrong one, and the compound introduction
 *      filed "from Connolly System" as a SURNAME — which is what the phone book
 *      and the CSV export still say (CALL_IMPROVEMENTS.md #2, #10).
 */
import { describe, expect, it } from 'vitest';

import { normalizeSpelledName, splitNameAndCompany } from './nameCleanup.js';

describe('normalizeSpelledName', () => {
  it('HAPPY: collapses a spelled-out correction into the word', () => {
    expect(normalizeSpelledName('C-A-M-I-L-L-E')).toBe('Camille');
    expect(normalizeSpelledName('c a m i l l e')).toBe('Camille');
    expect(normalizeSpelledName('D.A.L.E')).toBe('Dale');
  });

  it('SAD: leaves ordinary names, initials and hyphenated surnames alone', () => {
    // The risk in any normalizer is that it "fixes" what was already right.
    expect(normalizeSpelledName('Camille')).toBe('Camille');
    expect(normalizeSpelledName('Marie-Claire')).toBe('Marie-Claire');
    expect(normalizeSpelledName('J. R. Smith')).toBe('J. R. Smith');
    expect(normalizeSpelledName('Jo Ann')).toBe('Jo Ann');
    expect(normalizeSpelledName('')).toBe('');
    expect(normalizeSpelledName(null)).toBe('');
  });
});

describe('splitNameAndCompany', () => {
  it('HAPPY: separates the person from the company they named in one breath', () => {
    expect(splitNameAndCompany('Jaya from Connolly Systems')).toEqual({
      name: 'Jaya',
      company: 'Connolly Systems',
    });
    expect(splitNameAndCompany('Sage with eTeam')).toEqual({ name: 'Sage', company: 'eTeam' });
    expect(splitNameAndCompany('Priya calling from Northgate')).toEqual({
      name: 'Priya',
      company: 'Northgate',
    });
  });

  it('SAD: leaves a plain name untouched — and never returns half a split', () => {
    expect(splitNameAndCompany('Camille DeMott')).toEqual({
      name: 'Camille DeMott',
      company: null,
    });
    expect(splitNameAndCompany('from Acme')).toEqual({ name: 'from Acme', company: null });
    expect(splitNameAndCompany('')).toEqual({ name: '', company: null });
  });
});
