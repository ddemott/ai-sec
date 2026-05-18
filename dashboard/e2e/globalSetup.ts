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
import { readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

const BACKEND_URL = process.env.BACKEND_URL ?? 'https://localhost:4001';
const REPO_ROOT = resolve(__dirname, '..', '..');

/**
 * Recursively find the newest mtime under a directory tree. Used to
 * detect when source files have been edited after the backend process
 * was last started (which means dist/ AND the running process are both
 * older than the bytes on disk → a rebuild + restart is owed).
 */
function newestMtime(dir: string): number {
  let max = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
        continue;
      }
      const sub = newestMtime(full);
      if (sub > max) max = sub;
    } else if (entry.isFile()) {
      const m = statSync(full).mtimeMs;
      if (m > max) max = m;
    }
  }
  return max;
}

/**
 * Check that the running backend was started AFTER the most-recently-
 * modified file under src/. If src is newer, the backend is serving an
 * older binary than the test suite assumes and any "false-red E2E"
 * mystery is going to look like a flake instead of a stale-dist issue.
 *
 * Bypass via PLAYWRIGHT_SKIP_BACKEND_STALENESS_CHECK=1 for niche cases
 * where you genuinely want to test against an older backend (e.g.
 * reproducing a regression).
 */
async function assertBackendFresh(): Promise<void> {
  if (process.env.PLAYWRIGHT_SKIP_BACKEND_STALENESS_CHECK === '1') return;

  let startedAt: string | undefined;
  try {
    // Self-signed cert on https://localhost:4001 — bypass via env var
    // so we don't have to wire a global rejectUnauthorized override.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const res = await fetch(`${BACKEND_URL}/health`);
    const body = (await res.json()) as { started_at?: string; status?: string };
    startedAt = body.started_at;
  } catch (err) {
    throw new Error(
      `[globalSetup] could not reach ${BACKEND_URL}/health to verify backend freshness: ${
        err instanceof Error ? err.message : String(err)
      }. Start the backend (\`npm start\` from the repo root) and re-run.`,
    );
  }

  if (!startedAt) {
    // Older backend deploys don't expose started_at — treat as a soft
    // warning instead of a hard fail. The watchdog still helps next
    // time around once the backend is updated.
    console.warn(
      '[globalSetup] /health did not include started_at — backend may be older than the staleness guard. Skipping check.',
    );
    return;
  }

  const backendMs = Date.parse(startedAt);
  const srcMs = newestMtime(join(REPO_ROOT, 'src'));
  if (Number.isNaN(backendMs) || srcMs === 0) return;

  if (srcMs > backendMs) {
    const lagSeconds = Math.round((srcMs - backendMs) / 1000);
    throw new Error(
      [
        `[globalSetup] STALE BACKEND DETECTED — running process is ${lagSeconds}s older than src/.`,
        `Backend started_at: ${startedAt}`,
        `Newest src/ mtime: ${new Date(srcMs).toISOString()}`,
        '',
        'TypeScript edits in src/ compile into dist/, but the running `node dist/src/index.js`',
        'process holds the OLD code in memory until killed + restarted. Run:',
        '',
        '  npm start                                                       (kills + rebuilds + restarts everything)',
        '  kill $(lsof -ti :4001) && npm run build && node dist/src/index.js &  (surgical)',
        '',
        'See CLAUDE.md Build Principles → "Backend code changes require BOTH a rebuild AND a restart."',
      ].join('\n'),
    );
  }
}

export default async function globalSetup() {
  await assertBackendFresh();

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
