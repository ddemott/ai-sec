// Helpers for interpreting backend `check_coverage_gaps` rows in the
// dashboard. The RPC returns 5 status values; the dashboard's badge
// component renders 3. Centralizing the mapping prevents StepReview
// and SoloStepReview from drifting.
//
// Why we map from `status`, not `coverage_pct`:
// pre-2026-05-07, both wizard review steps derived the badge from
// coverage_pct. The RPC returns coverage_pct=100 for the divide-by-zero
// "no one scheduled" case (see the `WHEN sc.open_count > 0 THEN ...
// ELSE 100.0` math), which made `pct >= 100 → 'full'` render a green
// "fully covered" badge on a tenant that literally has zero staff
// scheduled. The contract is pinned by
// `src/coverage-ui-consistency.test.ts`.

export type CoverageBadge = 'full' | 'partial' | 'uncovered';

export type BackendCoverageStatus = 'full' | 'good' | 'partial' | 'gap' | 'closed';

/**
 * Map a backend coverage status to the 3-state dashboard badge.
 *
 * - 'full' (100% covered) → 'full' (green)
 * - 'good' (≥80%) and 'partial' (≥50%) → 'partial' (amber)
 * - 'gap' (<50%) and 'closed' (no one scheduled) → 'uncovered' (red)
 *
 * 'closed' specifically must NOT render 'full': it indicates zero open
 * hours for the day, which is the opposite of full coverage.
 */
export function statusToBadge(status: string | null | undefined): CoverageBadge {
  switch (status) {
    case 'full':
      return 'full';
    case 'good':
    case 'partial':
      return 'partial';
    case 'gap':
    case 'closed':
    default:
      return 'uncovered';
  }
}

/**
 * Returns true only when every coverage row is fully covered (status ===
 * 'full'). Used by the wizard review's "ready to go" green banner.
 *
 * Empty input (no coverage data yet) returns false — the banner should
 * not fire on a blank state.
 */
export function isAllCovered(coverage: { status?: string | null }[]): boolean {
  return coverage.length > 0 && coverage.every((c) => c.status === 'full');
}
