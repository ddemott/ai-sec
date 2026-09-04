/**
 * scripts/sql/restore-role-grants.sql — the privileges a baseline rebuild puts back.
 *
 * WHY THIS EXISTS
 * CI builds its database from the migration CHAIN, so nothing in CI ever
 * executes the baseline-restore path. A regression there is invisible until a
 * developer runs scripts/rebuild-db.sh and their whole realdb suite goes red
 * with "permission denied for table tenants" — which is exactly what happened
 * on 2026-09-04, 332 failures across 49 files, because the restore step handled
 * app_user and not api_user (tests/utils.ts connects as api_user).
 *
 * It also pins the privilege SET, not just its existence. The first fix for the
 * outage above re-ran 20260228000003_api_user.sql, which grants ALL PRIVILEGES
 * — silently handing back the TRUNCATE that BUG-008 revoked. That is why this
 * file exists separately from the migrations at all, and why this test asserts
 * an exact privilege list rather than a nonzero count.
 *
 * WHO: any developer running scripts/rebuild-db.sh; Playwright's globalSetup.
 * WHAT: the SQL is idempotent and yields exactly SELECT/INSERT/UPDATE/DELETE
 *       for api_user on tenant-data tables — no TRUNCATE, no ownership.
 * WHEN: every CI run.
 * WHERE: scripts/sql/restore-role-grants.sql, run by scripts/rebuild-db.sh.
 * WHY: a rebuild that restores too little breaks every realdb test at once and
 *      reads like an RLS bug; one that restores too much quietly re-grants a
 *      privilege the schema deliberately took away.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Client } from 'pg';
import { getRootClient, skipIfDbDown } from '../utils';

const SQL_PATH = resolve(__dirname, '../../scripts/sql/restore-role-grants.sql');
const EXPECTED = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'];

let root: Client;
let dbAvailable = false;

beforeAll(async () => {
  try {
    root = await getRootClient();
    await root.query('SELECT 1');
    dbAvailable = true;
  } catch (err) {
    console.warn('[restoreRoleGrants.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (root) await root.end();
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
});

async function apiUserPrivilegesOn(table: string): Promise<string[]> {
  const res = await root.query(
    `SELECT DISTINCT privilege_type
       FROM information_schema.role_table_grants
      WHERE grantee = 'api_user' AND table_name = $1
      ORDER BY privilege_type`,
    [table]
  );
  return res.rows.map((r) => r.privilege_type as string);
}

describe('restore-role-grants.sql', () => {
  it('HAPPY: is idempotent — running it twice leaves the same privileges', async () => {
    // Running it here is safe precisely because it asserts the state that
    // should already hold; it restores, it does not mutate into something new.
    const sql = readFileSync(SQL_PATH, 'utf8');
    await root.query(sql);
    const first = await apiUserPrivilegesOn('tenants');
    await root.query(sql);
    const second = await apiUserPrivilegesOn('tenants');
    expect(second).toEqual(first);
    expect(first).toEqual(EXPECTED);
  });

  it('SAD: api_user must NOT hold TRUNCATE — BUG-008 revoked it and a naive restore hands it back', async () => {
    await root.query(readFileSync(SQL_PATH, 'utf8'));
    for (const table of ['tenants', 'customers', 'appointments']) {
      expect(
        await apiUserPrivilegesOn(table),
        `api_user privileges on ${table} drifted from the BUG-008 set`
      ).toEqual(EXPECTED);
    }
  });

  it('HAPPY: rebuild-db.sh restores BOTH login roles, not just app_user', async () => {
    // The 2026-09-04 outage in one assertion: the step restored one role and the
    // test rig connects as the other.
    const script = readFileSync(resolve(__dirname, '../../scripts/rebuild-db.sh'), 'utf8');
    expect(script).toContain('20260724000100_app_user_role.sql');
    expect(script).toContain('restore-role-grants.sql');
    // And it must FAIL rather than announce success on a silent zero.
    expect(script).toMatch(/for ROLE in app_user api_user/);
    expect(script).toMatch(/FATAL/);
  });
});
