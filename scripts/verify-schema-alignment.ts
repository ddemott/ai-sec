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

import { readFileSync, existsSync, readdirSync } from 'fs';
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

/**
 * Catch baseline.sql drifting behind the migration chain.
 *
 * baseline.sql is a pg_dump snapshot used by rebuild-db / Playwright globalSetup
 * for speed. If a migration ADDs a column but the snapshot isn't regenerated,
 * every rebuilt DB silently lacks that column (this happened to is_demo,
 * tts_*, forward_phone — the demo + voice columns — breaking /demo/start and
 * the E2E foundation, found 2026-06-12 by scripts/simulate.sh).
 *
 * Self-maintaining: scans every migration for `ADD COLUMN [IF NOT EXISTS] <col>`,
 * subtracts columns a later migration `DROP`s, and asserts each surviving column
 * name appears somewhere in baseline.sql. No hand-maintained list to rot. Fix on
 * failure: regenerate baseline with `pg_dump --schema-only` after a clean
 * migration-chain rebuild.
 */
export function checkMigrationColumnsInBaseline(
  baselineSql: string,
  migrationsSql: string[]
): Drift[] {
  const added = new Set<string>();
  const gone = new Set<string>(); // dropped OR renamed away — not expected in final baseline
  const addRe = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
  const dropRe = /DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
  // PK-rename migrations ADD a transient column (e.g. new_id) then RENAME it to
  // the real `<table>_id`. The renamed-FROM name never lands in baseline.
  const renameRe = /RENAME\s+COLUMN\s+"?([a-z_][a-z0-9_]*)"?\s+TO/gi;

  for (const sql of migrationsSql) {
    for (const m of sql.matchAll(addRe)) added.add(m[1].toLowerCase());
    for (const m of sql.matchAll(dropRe)) gone.add(m[1].toLowerCase());
    for (const m of sql.matchAll(renameRe)) gone.add(m[1].toLowerCase());
  }

  const drifts: Drift[] = [];
  for (const col of added) {
    if (gone.has(col)) continue; // added then later dropped or renamed — not in baseline
    // Word-boundary presence anywhere in the snapshot.
    if (!new RegExp(`\\b${col}\\b`).test(baselineSql)) {
      drifts.push({
        check: 'baseline-migration-drift',
        message: `Column "${col}" is added by a migration but missing from baseline.sql — regenerate the snapshot (pg_dump --schema-only after a migration-chain rebuild).`,
      });
    }
  }
  return drifts;
}

/**
 * Catch a NEW TABLE landing in a migration but not in baseline.sql.
 *
 * `checkMigrationColumnsInBaseline` only scans `ADD COLUMN`, so a table created
 * via `CREATE TABLE foo (...)` — whose columns are declared inline, never via
 * ADD COLUMN — escapes it entirely. That is exactly how knowledge_suggestion /
 * customer_messages / ai_cost_events drifted out of the baseline (found
 * 2026-06-19): the whole table was absent from every baseline-built DB while the
 * column guard stayed green.
 *
 * Scans every migration for `CREATE TABLE [IF NOT EXISTS] <name>`, subtracts
 * tables a later migration DROPs or RENAMEs away, and asserts each survivor has
 * a CREATE TABLE in baseline.sql. Fix on failure: `npm run db:baseline`.
 */
export function checkMigrationTablesInBaseline(
  baselineSql: string,
  migrationsSql: string[]
): Drift[] {
  const created = new Set<string>();
  const gone = new Set<string>(); // dropped OR renamed-away — not expected in final baseline
  const createRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  const dropRe = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  const renameRe =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+RENAME\s+TO/gi;

  // Strip SQL comments first — a comment like "... CREATE TABLE IF NOT EXISTS,
  // no backfill" otherwise mis-parses the keyword "if" as a table name.
  const stripComments = (sql: string) =>
    sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

  for (const raw of migrationsSql) {
    const sql = stripComments(raw);
    for (const m of sql.matchAll(createRe)) created.add(m[1].toLowerCase());
    for (const m of sql.matchAll(dropRe)) gone.add(m[1].toLowerCase());
    for (const m of sql.matchAll(renameRe)) gone.add(m[1].toLowerCase());
  }
  // schema_migrations is created by setup-db.sh, not a migration — and is always
  // in the dump — so it never needs this guard either way.
  created.delete('schema_migrations');

  const drifts: Drift[] = [];
  for (const table of created) {
    if (gone.has(table)) continue; // created then later dropped or renamed away
    const present = new RegExp(
      `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${table}\\b`,
      'i'
    ).test(baselineSql);
    if (!present) {
      drifts.push({
        check: 'baseline-migration-drift',
        message: `Table "${table}" is created by a migration but missing from baseline.sql — regenerate the snapshot (npm run db:baseline).`,
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
  const migrationsDir = join(repoRoot, 'supabase/migrations');
  const migrationsSql = existsSync(migrationsDir)
    ? readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => readFileSync(join(migrationsDir, f), 'utf8'))
    : [];

  const drifts = [
    ...checkCriticalIdColumns(baselineSql),
    ...checkMigrationColumnsInBaseline(baselineSql, migrationsSql),
    ...checkMigrationTablesInBaseline(baselineSql, migrationsSql),
  ];

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
