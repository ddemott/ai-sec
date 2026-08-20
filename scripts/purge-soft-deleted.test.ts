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
  it('SAD: refuses a non-numeric age instead of silently purging everything', () => {
    const res = run(['--older-than', 'abc']);
    expect(res.status).not.toBe(0);
    expect(`${res.stderr}${res.stdout}`).toMatch(/--older-than expects a non-negative number/);
  });

  it('SAD: refuses a negative age', () => {
    // A negative interval would push the cutoff into the FUTURE, making the
    // clause match every row — the same over-broad purge by a different route.
    const res = run(['--older-than', '-5']);
    expect(res.status).not.toBe(0);
    expect(`${res.stderr}${res.stdout}`).toMatch(/--older-than expects a non-negative number/);
  });

  it('HAPPY: a valid age is accepted (fails later, at the DB, not at the guard)', () => {
    // Proves the guard did not become over-tight: a legitimate value must get
    // PAST the parse. It then fails to connect, which is the expected and
    // desired outcome for a test that must never reach a real database.
    const res = run(['--older-than', '30']);
    expect(`${res.stderr}${res.stdout}`).not.toMatch(/--older-than expects/);
  });
});
