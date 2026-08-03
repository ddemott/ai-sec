import { describe, it, expect } from 'vitest';
import {
  checkCriticalIdColumns,
  checkMigrationColumnsInBaseline,
  checkMigrationTablesInBaseline,
  checkRlsPolicyCoverage,
  CRITICAL_TABLES,
} from './verify-schema-alignment';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const baseline = readFileSync('supabase/baseline.sql', 'utf8');
const migrations = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join('supabase/migrations', f), 'utf8'));

describe('verify-schema-alignment (historical REFACTORING_TODO #9; see RESOLVED.md)', () => {
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

describe('baseline ↔ migration drift guard', () => {
  // WHO: a dev who adds a column via migration but forgets to regenerate baseline.sql.
  // WHAT: every migration-added column (minus dropped/renamed) must appear in baseline.sql.
  // WHEN: run in prepare-commit / CI on the committed baseline + migrations.
  // WHERE: checkMigrationColumnsInBaseline.
  // WHY: stale baseline silently ships DBs missing columns — is_demo/tts_*/forward_phone
  //      drift broke /demo/start + the Playwright E2E foundation (found 2026-06-12).
  it('passes: the committed baseline.sql contains every live migration column', () => {
    const drifts = checkMigrationColumnsInBaseline(baseline, migrations);
    expect(drifts).toEqual([]);
  });

  it('detects a column added by a migration but missing from baseline', () => {
    // A migration adds zzz_drift_probe; baseline never gets it → drift.
    const fakeMigration = 'ALTER TABLE tenants ADD COLUMN IF NOT EXISTS zzz_drift_probe TEXT;';
    const drifts = checkMigrationColumnsInBaseline(baseline, [...migrations, fakeMigration]);
    expect(drifts.length).toBeGreaterThan(0);
    expect(drifts.some((d) => d.message.includes('zzz_drift_probe'))).toBe(true);
  });

  it('ignores a column that a later migration drops or renames away', () => {
    // Added then dropped, and added then renamed — neither is expected in baseline.
    const churn = [
      'ALTER TABLE tenants ADD COLUMN tmp_a TEXT;',
      'ALTER TABLE tenants DROP COLUMN tmp_a;',
      'ALTER TABLE tenants ADD COLUMN tmp_b TEXT;',
      'ALTER TABLE tenants RENAME COLUMN tmp_b TO tenant_real_col;',
    ];
    const drifts = checkMigrationColumnsInBaseline(baseline, [...migrations, ...churn]);
    expect(drifts.some((d) => d.message.includes('tmp_a'))).toBe(false);
    expect(drifts.some((d) => d.message.includes('tmp_b'))).toBe(false);
  });
});

describe('baseline ↔ migration TABLE drift guard', () => {
  // WHO: a dev who adds a whole table via CREATE TABLE but forgets db:baseline.
  // WHAT: every migration-created table (minus dropped/renamed) must be in baseline.sql.
  // WHEN: prepare-commit / CI on the committed baseline + migrations.
  // WHERE: checkMigrationTablesInBaseline.
  // WHY: CREATE TABLE declares columns inline, so the column guard never sees them —
  //      knowledge_suggestion/customer_messages/ai_cost_events drifted out of baseline
  //      entirely while the column guard stayed green (found 2026-06-19).
  it('passes: the committed baseline.sql contains every live migration table', () => {
    const drifts = checkMigrationTablesInBaseline(baseline, migrations);
    expect(drifts).toEqual([]);
  });

  it('detects a table created by a migration but missing from baseline', () => {
    const fakeMigration = 'CREATE TABLE IF NOT EXISTS zzz_drift_table (id uuid PRIMARY KEY);';
    const drifts = checkMigrationTablesInBaseline(baseline, [...migrations, fakeMigration]);
    expect(drifts.some((d) => d.message.includes('zzz_drift_table'))).toBe(true);
  });

  it('ignores a table that a later migration drops or renames away', () => {
    const churn = [
      'CREATE TABLE tmp_tbl_a (id uuid);',
      'DROP TABLE tmp_tbl_a;',
      'CREATE TABLE tmp_tbl_b (id uuid);',
      'ALTER TABLE tmp_tbl_b RENAME TO tmp_tbl_renamed;',
    ];
    const drifts = checkMigrationTablesInBaseline(baseline, [...migrations, ...churn]);
    expect(drifts.some((d) => d.message.includes('tmp_tbl_a'))).toBe(false);
    expect(drifts.some((d) => d.message.includes('tmp_tbl_b'))).toBe(false);
  });

  it('does not mis-parse the keyword "if" from a CREATE TABLE comment', () => {
    // A comment mentioning "CREATE TABLE IF NOT EXISTS, ..." must not register "if".
    const commented = '-- pure additive CREATE TABLE IF NOT EXISTS, no backfill\nSELECT 1;';
    const drifts = checkMigrationTablesInBaseline(baseline, [...migrations, commented]);
    expect(drifts.some((d) => d.message.includes('"if"'))).toBe(false);
  });
});

describe('RLS policy coverage guard', () => {
  // WHO: a dev who ships CREATE TABLE + ENABLE ROW LEVEL SECURITY but no policy.
  // WHAT: every RLS-enabled table in baseline.sql must have >=1 CREATE POLICY
  //       and must be FORCEd, not just ENABLEd.
  // WHEN: prepare-commit / CI on the committed baseline.
  // WHERE: checkRlsPolicyCoverage.
  // WHY: RLS-enabled-with-zero-policies is deny-all for any non-bypassing role
  //      (app_user, since 2026-07-24) — this is exactly the shape of the
  //      message_delivery_status landmine (found 2026-07-13, fixed 2026-07-24
  //      by 20260724000050_rls_close_gaps.sql). Nothing previously checked for
  //      a repeat.
  it('passes: every RLS-enabled table in the committed baseline has a policy and is forced', () => {
    const drifts = checkRlsPolicyCoverage(baseline);
    expect(drifts).toEqual([]);
  });

  it('detects a table with RLS enabled but no policy', () => {
    const broken = `
      ALTER TABLE ONLY public.zzz_rls_probe FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.zzz_rls_probe ENABLE ROW LEVEL SECURITY;
    `;
    const drifts = checkRlsPolicyCoverage(broken);
    expect(
      drifts.some(
        (d) => d.message.includes('zzz_rls_probe') && d.message.includes('no CREATE POLICY')
      )
    ).toBe(true);
  });

  it('detects a table with RLS enabled but not forced', () => {
    const broken = `
      ALTER TABLE public.zzz_rls_probe ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Tenant isolation for zzz_rls_probe" ON public.zzz_rls_probe USING (tenant_id = tenant_ctx_uuid());
    `;
    const drifts = checkRlsPolicyCoverage(broken);
    expect(
      drifts.some((d) => d.message.includes('zzz_rls_probe') && d.message.includes('not FORCED'))
    ).toBe(true);
  });

  it('is clean when a table is enabled, forced, and has a policy', () => {
    const ok = `
      ALTER TABLE ONLY public.zzz_rls_probe FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.zzz_rls_probe ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "Tenant isolation for zzz_rls_probe" ON public.zzz_rls_probe USING (tenant_id = tenant_ctx_uuid());
    `;
    expect(checkRlsPolicyCoverage(ok)).toEqual([]);
  });
});
