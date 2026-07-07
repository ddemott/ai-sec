/**
 * coverage.ts — dashboard helpers for interpreting backend check_coverage_gaps rows.
 *
 * WHO: Any wizard review step or coverage badge in the dashboard.
 * WHAT: statusToBadge maps 5 backend statuses → 3 badge states; isAllCovered
 *   returns true only when every slot is 'full'. Both are pure functions.
 * WHERE: lib/coverage.ts — previously 16.66% coverage.
 * WHY: statusToBadge's 'closed' branch was untested; that case must map to
 *   'uncovered' not 'full', otherwise the go-live banner fires on a tenant
 *   with zero staff scheduled (divide-by-zero in the RPC returns pct=100).
 */
import { describe, test, expect } from 'vitest';
import { statusToBadge, isAllCovered } from './coverage';

describe('statusToBadge', () => {
  test('HAPPY: full → full (green badge)', () => {
    expect(statusToBadge('full')).toBe('full');
  });

  test('HAPPY: good → partial (amber badge)', () => {
    expect(statusToBadge('good')).toBe('partial');
  });

  test('HAPPY: partial → partial (amber badge)', () => {
    expect(statusToBadge('partial')).toBe('partial');
  });

  test('HAPPY: gap → uncovered (red badge)', () => {
    expect(statusToBadge('gap')).toBe('uncovered');
  });

  test('CRITICAL: closed → uncovered (not full!) — divide-by-zero case', () => {
    // RPC returns pct=100 when no one is scheduled (ELSE 100.0 branch).
    // Badge must be red, not green, so the go-live banner never fires.
    expect(statusToBadge('closed')).toBe('uncovered');
  });

  test('HAPPY: null → uncovered (default fallthrough)', () => {
    expect(statusToBadge(null)).toBe('uncovered');
  });

  test('HAPPY: undefined → uncovered (default fallthrough)', () => {
    expect(statusToBadge(undefined)).toBe('uncovered');
  });

  test('HAPPY: unknown string → uncovered (default fallthrough)', () => {
    expect(statusToBadge('bogus')).toBe('uncovered');
  });
});

describe('isAllCovered', () => {
  test('HAPPY: all full → true', () => {
    expect(isAllCovered([{ status: 'full' }, { status: 'full' }])).toBe(true);
  });

  test('HAPPY: empty array → false (no data = not ready)', () => {
    // Prevents the banner firing when coverage data hasn't loaded yet.
    expect(isAllCovered([])).toBe(false);
  });

  test('SAD: one non-full row → false', () => {
    expect(isAllCovered([{ status: 'full' }, { status: 'partial' }])).toBe(false);
  });

  test('SAD: null status → false', () => {
    expect(isAllCovered([{ status: null }])).toBe(false);
  });

  test('SAD: closed status → false (even though RPC reports pct=100)', () => {
    expect(isAllCovered([{ status: 'closed' }])).toBe(false);
  });
});
