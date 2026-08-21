/**
 * Coverage preview for an unsaved setup-wizard draft.
 *
 * Extracted from src/routes/analytics.ts (2026-08-21).
 *
 * THIS IS THE ONE ANALYTICS PATH THAT WRITES. It inserts an entire draft graph
 * — services, resources, employees, shifts, mappings — so `check_coverage_gaps`
 * has something to measure, then rolls the whole thing back. The ROLLBACK sits
 * in a `finally` and must stay there: on the success path alone, a preview that
 * threw would LEAK the draft into the tenant's real data, creating services and
 * staff from a form the owner never submitted. `tests/routes/
 * analytics-characterization.test.ts` pins both the happy rollback and the
 * rollback-on-throw for exactly that reason.
 *
 * Window resolution lives here too, because both halves of it are correctness
 * rather than formatting: `check_coverage_gaps` runs `generate_series(start,
 * end)`, and an unbounded or inverted window yields NO ROWS — which reads as
 * perfect coverage. So an absent end defaults to a 4-week horizon (matching the
 * wizard's forward-schedule expansion), and an inverted window is refused by the
 * caller rather than silently reported as "no gaps".
 */
import type { PoolClient } from 'pg';
import {
  findDuplicateTmpIds,
  findMissingTmpIdReferences,
  weeksAheadFor,
  insertDraftGraph,
} from '../setupGraph';
import type { CoverageDryRunSchema, CoverageGapRow } from './dateBounds';
import type { z } from 'zod';

type Draft = z.infer<typeof CoverageDryRunSchema>;

/** The window the preview will measure, with both bounds always present. */
export function resolveCoverageWindow(draft: { start_date?: string; end_date?: string }): {
  startDate: string;
  endDate: string;
} {
  const startDate = draft.start_date ?? new Date().toISOString().split('T')[0];
  const endDate =
    draft.end_date ??
    new Date(Date.parse(`${startDate}T00:00:00Z`) + 27 * 86_400_000).toISOString().split('T')[0];
  return { startDate, endDate };
}

/**
 * Reasons a draft cannot be previewed, in the order the route reports them.
 * Returns null when the draft is sound.
 *
 * A dangling tmp_id is a client bug, and silently dropping the reference would
 * render a coverage preview that does not describe the draft the owner is
 * looking at — worse than an error, because it looks like an answer.
 */
export function findDraftGraphProblem(draft: Draft): { error: string; details: unknown[] } | null {
  const duplicates = findDuplicateTmpIds(draft);
  if (duplicates.length > 0) {
    return { error: 'Draft contains duplicate tmp_ids', details: duplicates };
  }
  const missing = findMissingTmpIdReferences(draft);
  if (missing.length > 0) {
    return { error: 'Draft references unknown tmp_ids', details: missing };
  }
  return null;
}

/**
 * Insert the draft, measure coverage, and roll back — always.
 */
export async function previewCoverageForDraft(
  client: PoolClient,
  tenantId: string,
  draft: Draft,
  window: { startDate: string; endDate: string }
): Promise<CoverageGapRow[]> {
  const { startDate, endDate } = window;
  await client.query('BEGIN');
  try {
    // insertDraftGraph writes the FULL column set it is given (description,
    // price, contact fields); dry-run simply never sends them, since a coverage
    // preview does not need them and everything rolls back regardless.
    await insertDraftGraph(client, tenantId, draft, {
      weeksAhead: weeksAheadFor(startDate, endDate),
      startDate: new Date(`${startDate}T00:00:00Z`),
    });

    const res = await client.query<CoverageGapRow>(
      `SELECT service_id, service_name, check_date, gap_hours, covered_hours,
                    total_open_hours, coverage_pct, status, details
             FROM check_coverage_gaps($1, $2::DATE, $3::DATE)`,
      [tenantId, startDate, endDate]
    );
    return res.rows;
  } finally {
    // Never persist — this is a preview. Runs on the success AND error paths;
    // the rows are already materialized in JS by the time we get here.
    await client.query('ROLLBACK');
  }
}
