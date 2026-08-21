/**
 * Date parsing and validation shared by the analytics + coverage routes.
 *
 * Extracted from src/routes/analytics.ts (2026-08-21). A route should
 * orchestrate — validate input, call something, send a response — and these are
 * the pieces that are neither routing nor HTTP: a calendar-validity check, the
 * optional-bounds parser, and the schema and row type the coverage endpoints
 * share.
 *
 * They moved FIRST and TOGETHER because several routes depend on them, so
 * leaving them behind would have every extracted service importing back into
 * the route file — an extraction that points the wrong way.
 */
import { z } from 'zod';
import { DraftGraphSchema } from '../setupGraph';

export const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// One row of check_coverage_gaps output (per service, per date in the window).
export interface CoverageGapRow {
  service_id: string;
  service_name: string;
  check_date: string;
  gap_hours: number[] | null;
  covered_hours: number[] | null;
  total_open_hours: number;
  coverage_pct: string | number;
  status: string;
  details: Record<string, unknown> | null;
}

// Draft graph posted by the setup wizard (Phase B) to preview coverage BEFORE
// anything is persisted. Shares DraftGraphSchema with POST /setup/commit
// (src/routes/setup.ts) — see src/services/setupGraph.ts module doc. Every
// entity carries a client-side `tmp_id` so mappings + shifts can reference
// each other without real DB ids.
export const CoverageDryRunSchema = DraftGraphSchema.extend({
  // refine (not just regex): reject calendar-invalid but well-shaped dates like
  // 2026-02-30 here, so they never reach a `$n::date` cast (→ 500).
  start_date: z
    .string()
    .refine(isValidDateOnly, 'start_date must be a real YYYY-MM-DD date')
    .optional(),
  end_date: z
    .string()
    .refine(isValidDateOnly, 'end_date must be a real YYYY-MM-DD date')
    .optional(),
});

/**
 * True only for a real calendar date in YYYY-MM-DD form. The regex alone is not
 * enough: "2026-02-30" and "2026-13-01" are correctly *shaped* but not real
 * dates, and would pass straight through to a `$n::date` cast and throw a 500.
 * We round-trip through a UTC Date and require every component to survive, so a
 * calendar-invalid bound is rejected here (→ null → all-time), never at the DB.
 */
export function isValidDateOnly(s: string): boolean {
  const m = DATE_ONLY_RE.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

/**
 * Optional, unbounded-by-default date window for the analytics endpoints.
 * Unlike parseDateRange (which defaults the start to *today* — right for a
 * coverage lookup, wrong for analytics where "no filter" means all-time), this
 * returns null for any missing/malformed/calendar-invalid bound. Callers pass
 * [tenantId, start, end] and guard each side with `($n::date IS NULL OR col >=
 * $n::date)` so an absent bound drops out of the predicate entirely. `end` is
 * treated as inclusive of the whole day via `< $end::date + interval '1 day'`.
 */
export function optionalDateBounds(query: Record<string, string>): {
  start: string | null;
  end: string | null;
} {
  const start = query.start_date && isValidDateOnly(query.start_date) ? query.start_date : null;
  const end = query.end_date && isValidDateOnly(query.end_date) ? query.end_date : null;
  return { start, end };
}
