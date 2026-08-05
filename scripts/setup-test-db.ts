#!/usr/bin/env -S npx tsx

/**
 * scripts/setup-test-db.ts
 *
 * Test DB bootstrap for RLS tests.
 *
 * - Creates 'test_db' if it does not exist (using superuser on the postgres DB).
 * - Runs ALL migrations from supabase/migrations/ *lexically* up to and
 *   including 20260724000100_app_user_role.sql as the superuser.
 * - Ensures the app_user role exists with NOBYPASSRLS (the migration does this;
 *   we re-assert it for safety).
 * - Verifies the role cannot bypass RLS.
 * - Guards against accidental runs on prod-like DBs.
 *
 * Matches style from src/database/index.ts (detailed comments, Pool-like patterns
 * but using Client for one-off bootstrap), tests/utils.ts (ROOT_DB_URL, skip helpers),
 * and the bash DB scripts (idempotent, clear output, safety checks).
 *
 * Usage:
 *   npx tsx scripts/setup-test-db.ts
 *   TEST_ADMIN_DATABASE_URL=... npx tsx scripts/setup-test-db.ts
 *
 * After this, `npm run test` no longer throws the "Cannot reach the database as app_user"
 * error in tests/regression/rlsIsolation.test.ts. The test now uses test_db consistently.
 *
 * Part of fixing the RLS posture enforcement for CI and local dev.
 */

import { Client } from 'pg';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const TARGET_MIGRATION = '20260724000100_app_user_role.sql';
const ROOT_DIR = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT_DIR, 'supabase/migrations');

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://postgres:***@localhost:5433/postgres';

// Guard: never run on anything that looks like production.
function isSafeTarget(url: string): boolean {
  const lower = url.toLowerCase();
  const host = (lower.match(/@([^:/]+)/)?.[1] ?? '').toLowerCase();
  const dbname = (lower.match(/\/([^?]+)(?:\?|$)/)?.[1] ?? 'postgres').toLowerCase();

  if (lower.includes('prod') || lower.includes('production') || lower.includes('railway.app')) {
    return false;
  }
  if (!['localhost', '127.0.0.1', 'db', 'postgres', 'secretary-hq-db'].includes(host)) {
    return false;
  }
  if (dbname.includes('prod') || dbname === 'postgres' && !lower.includes('test')) {
    // Allow postgres DB only if explicitly for test setup; prefer test_db.
    console.warn('[setup-test-db] Using postgres DB — consider test_db for isolation.');
  }
  return true;
}

if (!isSafeTarget(ADMIN_URL)) {
  console.error('[setup-test-db] REFUSED: Target does not look like a local test database.');
  console.error('  URL:', ADMIN_URL.replace(/:[^@]+@/, ':***@'));
  console.error('  Use TEST_ADMIN_DATABASE_URL pointing at localhost test_db or pass --force (not recommended).');
  process.exit(2);
}

const TEST_DB_URL = ADMIN_URL.includes('/test_db')
  ? ADMIN_URL
  : ADMIN_URL.replace(/\/[^/]+$/, '/test_db');

console.log('[setup-test-db] Target test DB:', TEST_DB_URL.replace(/:[^@]+@/, ':***@'));

async function createTestDbIfMissing(superClient: Client) {
  const res = await superClient.query(
    "SELECT 1 FROM pg_database WHERE datname = 'test_db'"
  );
  if (res.rows.length === 0) {
    console.log('[setup-test-db] Creating test_db...');
    // Use template0 to avoid encoding issues with template1 if it has data.
    await superClient.query("CREATE DATABASE test_db WITH TEMPLATE template0 ENCODING 'UTF8'");
    console.log('[setup-test-db] test_db created.');
  } else {
    console.log('[setup-test-db] test_db already exists.');
  }
}

async function setupSchemaMigrations(client: Client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      filename    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('[setup-test-db] schema_migrations table ready.');
}

async function runMigrationsUpToTarget(client: Client) {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{14}_.*\.sql$/.test(f))
    .sort();  // lexical = chronological due to timestamp prefix

  const targetIndex = files.indexOf(TARGET_MIGRATION);
  if (targetIndex === -1) {
    throw new Error(`Target migration ${TARGET_MIGRATION} not found.`);
  }

  const migrationsToRun = files.slice(0, targetIndex + 1);

  console.log(`[setup-test-db] Will run ${migrationsToRun.length} migrations up to ${TARGET_MIGRATION}.`);

  const appliedRes = await client.query('SELECT version FROM schema_migrations');
  const applied = new Set(appliedRes.rows.map((r: any) => r.version));

  let appliedCount = 0;
  for (const fname of migrationsToRun) {
    const version = fname.split('_')[0];
    if (applied.has(version)) {
      console.log(`SKIP    ${fname}`);
      continue;
    }

    const fullPath = path.join(MIGRATIONS_DIR, fname);
    const sql = fs.readFileSync(fullPath, 'utf8');

    console.log(`APPLY   ${fname}`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, filename) VALUES ($1, $2)',
        [version, fname]
      );
      await client.query('COMMIT');
      appliedCount++;
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`FAIL    ${fname}`);
      console.error('  ', err.message);
      throw err;
    }
  }
  console.log(`[setup-test-db] Applied ${appliedCount} new migrations.`);
}

async function ensureAppUserRole(client: Client) {
  // The migration already does this idempotently, but we re-assert NOBYPASSRLS
  // explicitly per the task. Matches the DO $role$ block in the migration.
  await client.query(`
    DO $role$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user LOGIN PASSWORD 'app_user'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      ELSE
        ALTER ROLE app_user NOSUPERUSER NOBYPASSRLS;
      END IF;
    END
    $role$;
  `);

  // Re-apply grants in case baseline or partial runs dropped them (as noted in rebuild-db.sh).
  await client.query(`
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;

    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO app_user;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT EXECUTE ON FUNCTIONS TO app_user;
  `);

  console.log('[setup-test-db] app_user role created/re-asserted with NOBYPASSRLS.');
}

async function verifyRole(client: Client) {
  const res = await client.query<{ bypasses: boolean }>(
    `SELECT (rolsuper OR rolbypassrls) AS bypasses
     FROM pg_roles WHERE rolname = 'app_user'`
  );
  const bypasses = res.rows[0]?.bypasses ?? true;
  if (bypasses) {
    throw new Error('app_user can bypass RLS — verification failed. The role is pointless.');
  }
  console.log('[setup-test-db] Verification passed: app_user has NOBYPASSRLS.');
}

async function main() {
  console.log('[setup-test-db] Starting test DB bootstrap...');

  // Superuser client for creating DB (connects to postgres by default).
  const superClient = new Client({ connectionString: ADMIN_URL });
  await superClient.connect();

  try {
    await createTestDbIfMissing(superClient);
  } finally {
    await superClient.end();
  }

  // Now connect to test_db as superuser for migrations + role setup.
  const testClient = new Client({ connectionString: TEST_DB_URL });
  await testClient.connect();

  try {
    await setupSchemaMigrations(testClient);
    await runMigrationsUpToTarget(testClient);
    await ensureAppUserRole(testClient);
    await verifyRole(testClient);

    console.log('\n[setup-test-db] SUCCESS: test_db is ready for RLS tests.');
    console.log('  - test_db exists');
    console.log('  - migrations up to app_user_role.sql applied');
    console.log('  - app_user role with NOBYPASSRLS ready');
    console.log('  - rlsIsolation.test.ts should now pass without role error.');
  } finally {
    await testClient.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[setup-test-db] FAILED:', err.message);
    process.exit(1);
  });
}

export { main as bootstrapTestDb }; // for use in tests/utils.ts if imported
