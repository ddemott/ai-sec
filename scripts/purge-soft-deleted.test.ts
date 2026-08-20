/**
 * Guard for `purge-soft-deleted.ts`'s `--older-than` age guard.
 *
 * WHY THIS EXISTS. This script HARD-DELETES tenants — the one place in the
 * product where destruction is not soft. `OLDER_THAN_DAYS` was
 * `Number(valueOf('--older-than') ?? 0)`, so a non-numeric value produced NaN,
 * `NaN > 0` was false, and the `AND deleted_at < now() - interval '…'` clause
 * was omitted ENTIRELY. `--older-than abc --execute --yes` therefore purged
 * every soft-deleted tenant, including one deleted a minute ago, while the
 * operator believed they had asked for a floor. A mistyped guard must stop the
 * run, never silently widen it.
 *
 * The script is driven as a subprocess (same approach as
 * `fresh-clone-smoke.test.ts`) because the guard runs at module scope and calls
 * `process.exit` — the only honest way to assert it is to observe the exit code
 * of a real invocation.
 *
 * 5W for sad-path failures:
 *   WHO   — an operator running a maintenance purge against a real database
 *   WHAT  — scripts/purge-soft-deleted.ts --older-than
 *   WHEN  — any manual purge
 *   WHERE — the OLDER_THAN_DAYS parse at the top of the script
 *   WHY   — an unparseable age guard that is silently dropped destroys more
 *           than was asked for, irreversibly
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, 'purge-soft-deleted.ts');

/**
 * Every case here spawns `npx tsx`, which pays npx resolution plus a TypeScript
 * compile before a line of the script runs. That is seconds, not milliseconds,
 * and it is the MACHINE's speed rather than the code's behaviour.
 *
 * This budget must be stated explicitly, because vitest's default test timeout
 * is 5s while `run()`'s own `spawnSync` budget is 60s — two timeouts that
 * disagreed, with the shorter one arrived at by accident. On 2026-08-20 the
 * happy-path case took 5,862 ms on a loaded CI runner and vitest killed it at
 * 5,000 ms, turning `main` RED. That matters far more than one red test:
 * Railway marks the deployments of a red `main` commit SKIPPED, and SKIPPED is
 * terminal — so a slow runner silently stopped a merged commit from ever
 * reaching production.
 *
 * Matched to the subprocess budget deliberately. If the script ever really
 * hangs, `spawnSync` is what should report it, with its exit status and output,
 * rather than vitest reporting a bare "timed out" that names nothing.
 */
const SUBPROCESS_TEST_TIMEOUT_MS = 60_000;

function run(args: string[]) {
  return spawnSync('npx', ['tsx', SCRIPT, ...args], {
    encoding: 'utf-8',
    timeout: 60_000,
    // A DB URL is required before the script does anything else; point it at a
    // deliberately unreachable host so a test can never touch a real database.
    // The age guard runs BEFORE any connection, so a rejected value must exit
    // non-zero without ever attempting to connect.
    env: { ...process.env, DATABASE_URL: 'postgres://nobody@127.0.0.1:1/nonexistent' },
  });
}

describe('purge-soft-deleted --older-than guard', () => {
  it(
    'SAD: refuses a non-numeric age instead of silently purging everything',
    () => {
      const res = run(['--older-than', 'abc']);
      expect(res.status).not.toBe(0);
      expect(`${res.stderr}${res.stdout}`).toMatch(/--older-than expects a non-negative number/);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'SAD: refuses a negative age',
    () => {
      // A negative interval would push the cutoff into the FUTURE, making the
      // clause match every row — the same over-broad purge by a different route.
      const res = run(['--older-than', '-5']);
      expect(res.status).not.toBe(0);
      expect(`${res.stderr}${res.stdout}`).toMatch(/--older-than expects a non-negative number/);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'SAD: refuses --older-than passed with NO value at all',
    () => {
      // Found by review on PR #351 — my first version of this guard re-created the
      // very bug it was fixing, one step over. `valueOf` returns undefined both
      // when the flag was never passed AND when it was passed last with nothing
      // after it, and the parse treated the second case as the first: an operator
      // who typed --older-than got the behaviour of one who did not.
      const res = run(['--older-than']);
      expect(res.status).not.toBe(0);
      expect(`${res.stderr}${res.stdout}`).toMatch(/--older-than was passed with no value/);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'SAD: refuses --older-than immediately followed by another flag',
    () => {
      // `valueOf` would hand back '--execute' as the "value". Number('--execute')
      // is NaN and would be caught anyway, but the message would blame the wrong
      // thing; catching it here says what actually happened.
      const res = run(['--older-than', '--execute']);
      expect(res.status).not.toBe(0);
      expect(`${res.stderr}${res.stdout}`).toMatch(/--older-than was passed with no value/);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'HAPPY: a valid age is accepted (fails later, at the DB, not at the guard)',
    () => {
      // Proves the guard did not become over-tight: a legitimate value must get
      // PAST the parse. It then fails to connect, which is the expected and
      // desired outcome for a test that must never reach a real database.
      const res = run(['--older-than', '30']);
      expect(`${res.stderr}${res.stdout}`).not.toMatch(/--older-than expects/);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});
