/**
 * The two shapes a caller's NAME arrives in that the record cannot use as-is.
 * Both were live defects, both stored verbatim:
 *
 *   "C-A-M-I-L-L-E"              — a correction, SPELLED OUT. STT hands the
 *                                  letters over as written and they went
 *                                  straight into the row, so the fix for a
 *                                  wrong name produced a differently wrong one
 *                                  (CALL_IMPROVEMENTS.md #2).
 *   "Jaya from Connolly Systems" — a person AND their company in one breath.
 *                                  splitName filed "from Connolly System" as a
 *                                  SURNAME, which is what the phone book and
 *                                  the CSV export still say (#10).
 *
 * Agent-local on purpose: `shared/` is for the backend and dashboard (the agent
 * package cannot import across that boundary), and these run at exactly one
 * seam — record_answer, where a spoken name becomes stored state.
 */

/**
 * Collapse a spelled-out name into a word. Only fires on an unambiguous run of
 * single letters (3+), so ordinary names, initials ("J. R. Smith") and
 * hyphenated surnames ("Marie-Claire") are left exactly as they are — the risk
 * in any normalizer is that it "fixes" what was already right.
 *
 *   "C-A-M-I-L-L-E" → "Camille"      "c a m i l l e" → "Camille"
 *   "Camille"       → "Camille"      "Marie-Claire"  → "Marie-Claire"
 */
export function normalizeSpelledName(raw: string | null | undefined): string {
  const input = (raw ?? '').trim();
  if (!input) return '';
  const tokens = input.split(/[\s.\-]+/).filter(Boolean);
  if (tokens.length < 3 || !tokens.every((t) => /^[A-Za-z]$/.test(t))) return input;
  const word = tokens.join('');
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Split "Jaya from Connolly Systems" into the person and the company they
 * named, so each lands in its own field instead of the whole utterance becoming
 * a name.
 *
 * Conservative on purpose: only the explicit connectors a person actually uses,
 * and only when BOTH sides are non-empty. "Ford from Detroit" is a person and a
 * place to a human and unknowable to us — but filing the second half as a
 * company is still better than filing it as a surname.
 */
export function splitNameAndCompany(raw: string | null | undefined): {
  name: string;
  company: string | null;
} {
  const input = (raw ?? '').trim();
  if (!input) return { name: '', company: null };
  const m = /^(.+?)\s+(?:from|with|at|of|representing|calling from)\s+(.+)$/i.exec(input);
  if (!m) return { name: input, company: null };
  const name = m[1].trim();
  const company = m[2].trim();
  if (!name || !company) return { name: input, company: null };
  return { name, company };
}
