#!/usr/bin/env npx tsx
/**
 * Schema ↔ TS alignment guard (REFACTORING_TODO.md item 9).
 *
 * Cheap, fast check that the major domain tables that went through the
 * 2026-05 PK rename wave still have their canonical `<table>_id` columns
 * in supabase/baseline.sql.
 *
 * This is a first-line defense against re-introducing the class of bugs
 * that the big rename campaign was meant to eliminate (wrong id types,
 * missing columns after refactors, etc.).
 *
 * Run: `npx tsx scripts/verify-schema-alignment.ts`
 * Or via npm: `npm run verify:schema`
 *
 * Designed to be importable for unit tests (like verify-claude-md.ts).
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface Drift {
  check: string;
  message: string;
}

/**
 * List of critical tables that received the `_id` PK rename treatment.
 * Source of truth: the 20260512* pk_rename migrations.
 *
 * For each, we expect to find `    <table_singular>_id <type>` inside the
 * corresponding CREATE TABLE block in baseline.sql.
 */
export const CRITICAL_TABLES: Array<{
  table: string;
  expectedIdColumn: string;
  idType: string; // simplified for cheap check
}> = [
  { table: 'tenants', expectedIdColumn: 'tenant_id', idType: 'uuid' },
  { table: 'customers', expectedIdColumn: 'customer_id', idType: 'uuid' },
  { table: 'appointments', expectedIdColumn: 'appointment_id', idType: 'uuid' },
  { table: 'employees', expectedIdColumn: 'employee_id', idType: 'uuid' },
  { table: 'resources', expectedIdColumn: 'resource_id', idType: 'uuid' },
  { table: 'services', expectedIdColumn: 'service_id', idType: 'uuid' },
  { table: 'reminder_schedules', expectedIdColumn: 'reminder_schedule_id', idType: 'integer' },
  { table: 'consent_records', expectedIdColumn: 'consent_record_id', idType: 'integer' },
  { table: 'opt_out_records', expectedIdColumn: 'opt_out_record_id', idType: 'integer' },
];

/**
 * Very lightweight parser: looks for the CREATE TABLE block and checks
 * that the expected `_id` column declaration appears inside it.
 *
 * This is intentionally cheap (no full SQL parser) because the goal is
 * a fast gate in prepare-commit / CI, not a perfect linter.
 */
export function checkCriticalIdColumns(baselineSql: string): Drift[] {
  const drifts: Drift[] = [];

  for (const { table, expectedIdColumn, idType } of CRITICAL_TABLES) {
    // Find the CREATE TABLE block for this table (case insensitive, simple heuristic)
    const tableStart = baselineSql.search(
      new RegExp(`CREATE TABLE\\s+(?:public\\.)?${table}\\s*\\(`, 'i')
    );

    if (tableStart === -1) {
      drifts.push({
        check: 'schema-pk-columns',
        message: `Could not find CREATE TABLE for "${table}" in baseline.sql`,
      });
      continue;
    }

    // Take a reasonable slice after the table declaration (enough to cover columns)
    const slice = baselineSql.slice(tableStart, tableStart + 4000);

    // Look for the expected column declaration inside the block.
    // We accept the column appearing with the expected type (very loose match).
    const columnPattern = new RegExp(`\\b${expectedIdColumn}\\b\\s+${idType}`, 'i');

    if (!columnPattern.test(slice)) {
      drifts.push({
        check: 'schema-pk-columns',
        message: `Table "${table}" is missing expected column "${expectedIdColumn} ${idType}" (or the column declaration has drifted)`,
      });
    }
  }

  return drifts;
}

function main(): number {
  const repoRoot = process.cwd();
  const baselinePath = join(repoRoot, 'supabase/baseline.sql');

  if (!existsSync(baselinePath)) {
    console.error(`✗ supabase/baseline.sql not found at ${baselinePath}`);
    return 1;
  }

  const baselineSql = readFileSync(baselinePath, 'utf8');
  const drifts = checkCriticalIdColumns(baselineSql);

  if (drifts.length === 0) {
    console.log('✓ Schema alignment check passed — critical *_id columns present in baseline.sql');
    return 0;
  }

  console.error(`✗ Schema alignment drift detected (${drifts.length} issues):`);
  for (const d of drifts) {
    console.error(`  [${d.check}] ${d.message}`);
  }
  console.error(
    '\nThis usually means a table was added or refactored without updating the baseline or the corresponding TS row types.'
  );
  return 1;
}

// Run only when invoked directly
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  process.exit(main());
}
