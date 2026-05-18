/**
 * Playwright global setup — fires once before any spec runs.
 *
 * Rebuilds the database end-to-end via `scripts/rebuild-db.sh`:
 *   DROP SCHEMA public CASCADE
 *   → apply all migrations in order (tables, FKs, PKs, RLS, GRANTs,
 *     functions, triggers, indexes, types, extensions)
 *   → apply supabase/seed.sql (bare-bones tenants + owners + DynaTire
 *     business config)
 *
 * Every E2E run therefore starts from identical, validated state —
 * cross-spec data pollution is structurally impossible, AND the
 * migration chain is exercised before any test runs (so a broken
 * migration fails loudly here instead of mid-spec). ~15-30s overhead
 * per full E2E invocation.
 *
 * Skip the reset by setting `PLAYWRIGHT_SKIP_DB_RESET=1` (useful when
 * iterating against a hand-set-up state you don't want clobbered).
 *
 * Why the rebuild script instead of a faster TRUNCATE: the
 * truncate-and-reseed shortcut (~1-2s) skips the migration chain
 * entirely, so a future migration regression would only surface on
 * the next CI `db:rebuild` rather than on the dev loop. User locked
 * in 2026-05-18: "this should be everything including creating the
 * tables, relationships, PKs, FKs, even permissions, roles, etc."
 * The 30s overhead pays for full correctness.
 */
import { spawnSync } from 'child_process';
import { resolve } from 'path';

export default async function globalSetup() {
  if (process.env.PLAYWRIGHT_SKIP_DB_RESET === '1') {
    console.log('[globalSetup] PLAYWRIGHT_SKIP_DB_RESET=1 — keeping current DB state.');
    return;
  }
  const script = resolve(__dirname, '..', '..', 'scripts', 'rebuild-db.sh');
  console.log(`[globalSetup] rebuilding DB from scratch via ${script} — this validates the migration chain too.`);
  const result = spawnSync('bash', [script, '--yes'], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`[globalSetup] rebuild-db.sh exited ${result.status}; aborting test run`);
  }
}
