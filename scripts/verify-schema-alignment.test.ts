import { describe, it, expect } from 'vitest';
import { checkCriticalIdColumns, CRITICAL_TABLES } from './verify-schema-alignment';
import { readFileSync } from 'fs';

const baseline = readFileSync('supabase/baseline.sql', 'utf8');

describe('verify-schema-alignment (REFACTORING_TODO #9)', () => {
  it('passes cleanly against current baseline.sql for all critical tables', () => {
    const drifts = checkCriticalIdColumns(baseline);
    expect(drifts).toEqual([]);
  });

  it('detects a missing critical _id column (simulated)', () => {
    // Remove one known good column from a copy of the baseline for testing
    const broken = baseline.replace(
      /employee_id uuid DEFAULT gen_random_uuid\(\) NOT NULL/,
      '/* employee_id removed for test */'
    );
    const drifts = checkCriticalIdColumns(broken);
    expect(drifts.length).toBeGreaterThan(0);
    expect(drifts[0].message).toContain('employees');
    expect(drifts[0].message).toContain('employee_id');
  });

  it('has a reasonable list of critical tables', () => {
    expect(CRITICAL_TABLES.length).toBeGreaterThanOrEqual(6);
    expect(CRITICAL_TABLES.some((t) => t.table === 'customers')).toBe(true);
    expect(CRITICAL_TABLES.some((t) => t.table === 'appointments')).toBe(true);
  });
});
