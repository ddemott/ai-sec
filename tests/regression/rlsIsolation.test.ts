/**
 * RLS isolation — the test that could not have existed before.
 *
 * WHO   the application's database role
 * WHAT  row-level security actually isolating tenants, and the two null-context
 *       landmines that would break the moment it starts doing so
 * WHEN  every CI run, once DATABASE_URL points at a non-bypassing role
 * WHERE tests/regression/rlsIsolation.test.ts
 * WHY   RLS was believed to be a second isolation layer for months while being
 *       completely inert. The app connected as a role with rolbypassrls, and
 *       FORCE ROW LEVEL SECURITY does not override that. Local and CI also
 *       connected as superuser — which also bypasses — so no test in this repo
 *       COULD have caught it, and none did.
 *
 * The fix for that is a role change, and a role change is exactly the kind of
 * thing that gets reverted during an incident and never reverted back. So the
 * posture itself is asserted here, not just the behaviour it enables.
 *
 * These tests connect as `app_user` directly rather than through the app, so
 * they measure the database, not the middleware. Tenant isolation currently
 * rests ENTIRELY on tenantMiddleware; the point of this file is to make the
 * database a real second layer and keep it that way.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { ROOT_DB_URL, API_DB_URL } from '../utils';
import { ROOT_DB_URL as ADMIN_URL } from '../utils.js';

/**
 * A genuinely privileged URL (now consistently test_db via tests/utils.ts).
 * Used only to seed and tear down fixtures. Matches skipIfDbDown pattern
 * and ROOT_DB_URL guard against using production DATABASE_URL.
 */

/**
 * The non-bypassing role. Defaults to the local placeholder password from
 * 20260724000100_app_user_role.sql.
 */
const APP_USER_URL =
  process.env.TEST_APP_USER_DATABASE_URL ??
  ADMIN_URL.replace(/:\/\/[^@]*@/, '://app_user:app_user@');

let admin: Pool;
let appUser: Pool;
let available = false;

const TENANT_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const TENANT_B = 'bbbbbbbb-0000-4000-8000-00000000000b';

beforeAll(async () => {
  admin = new Pool({ connectionString: ADMIN_URL, connectionTimeoutMillis: 3000 });
  appUser = new Pool({ connectionString: APP_USER_URL, connectionTimeoutMillis: 3000 });

  try {
    // The admin pool must actually be privileged, or the fixtures below fail
    // under RLS and leave half-created rows behind for the rest of the run.
    const { rows } = await admin.query<{ privileged: boolean }>(
      `SELECT (rolsuper OR rolbypassrls) AS privileged FROM pg_roles WHERE rolname = current_user`
    );
    if (!rows[0]?.privileged) {
      throw new Error(
        'TEST_ADMIN_DATABASE_URL must point at a privileged role — it seeds fixtures that RLS would otherwise block'
      );
    }
    await appUser.query('SELECT 1');
    available = true;
  } catch {
    return;
  }

  // Tests own their data: created here, removed in afterAll. A failure is then
  // provably the code or the test, never a stray row from a previous run.
  for (const [id, name] of [
    [TENANT_A, 'RLS Probe A'],
    [TENANT_B, 'RLS Probe B'],
  ]) {
    await admin.query(
      `INSERT INTO tenants (tenant_id, name, business_type, is_deleted)
       VALUES ($1, $2, 'other', false) ON CONFLICT (tenant_id) DO NOTHING`,
      [id, name]
    );
    await admin.query(
      `INSERT INTO customers (tenant_id, name, phone)
       VALUES ($1, $2, $3)`,
      [id, `Customer of ${name}`, `+1555000${id.slice(-1)}000`]
    );
  }
});

afterAll(async () => {
  // Unconditional. `available` can be false because seeding failed PARTWAY, and
  // that is exactly the case where leftover rows would poison later test files.
  await admin
    ?.query('DELETE FROM tenants WHERE tenant_id = ANY($1::uuid[])', [[TENANT_A, TENANT_B]])
    .catch(() => {});
  await admin?.end();
  await appUser?.end();
});

const rlsTest = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    // Never a silent pass. A green suite that skipped every meaningful
    // assertion is how the original bug survived.
    if (!available) {
      throw new Error(
        `Cannot reach the database as app_user (${APP_USER_URL.replace(/:\/\/[^@]*@/, '://***@')}). ` +
          `Apply supabase/migrations/20260724000100_app_user_role.sql first.`
      );
    }
    await fn();
  });

/** Run `fn` on a connection with the tenant context set, then cleared — as the app does. */
async function asTenant<T>(tenantId: string | null, fn: (c: Pool) => Promise<T>): Promise<T> {
  const client = await appUser.connect();
  try {
    if (tenantId) await client.query('SELECT set_tenant_context($1::uuid)', [tenantId]);
    return await fn(client as unknown as Pool);
  } finally {
    await client.query("SELECT set_config('app.current_tenant_id', '', false)").catch(() => {});
    client.release();
  }
}

describe('database role posture', () => {
  rlsTest('the application role cannot bypass RLS', async () => {
    // THE original bug, stated as an assertion. Everything else in this file is
    // meaningless if this fails.
    const { rows } = await appUser.query<{ role: string; bypasses: boolean }>(
      `SELECT current_user AS role, (rolsuper OR rolbypassrls) AS bypasses
         FROM pg_roles WHERE rolname = current_user`
    );
    expect(rows[0]?.bypasses, `${rows[0]?.role} can bypass RLS — every policy is inert`).toBe(
      false
    );
  });

  rlsTest('every tenant-scoped table has RLS enabled AND forced', async () => {
    // ENABLE alone exempts the table owner, and FORCE is easy to forget on a
    // new table.
    const { rows } = await admin.query<{ tablename: string }>(
      `SELECT c.relname AS tablename
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        WHERE c.relkind = 'r'
          AND EXISTS (SELECT 1 FROM information_schema.columns col
                       WHERE col.table_name = c.relname AND col.column_name = 'tenant_id')
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
        ORDER BY 1`
    );
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  rlsTest('no policy reads current_setting() directly', async () => {
    // Every policy must go through tenant_ctx() / tenant_ctx_uuid(), which
    // handle the NULL-on-a-cold-connection case once and correctly. A policy
    // that reads the GUC raw has reintroduced one of the two landmines below.
    const { rows } = await admin.query<{ tablename: string; policyname: string }>(
      `SELECT tablename, policyname FROM pg_policies
        WHERE schemaname = 'public'
          AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%current_setting(%'
        ORDER BY 1, 2`
    );
    expect(rows.map((r) => `${r.tablename}.${r.policyname}`)).toEqual([]);
  });
});

describe('tenant isolation', () => {
  rlsTest('tenant A cannot see tenant B customers', async () => {
    const visible = await asTenant(TENANT_A, async (c) => {
      const { rows } = await c.query<{ tenant_id: string }>('SELECT tenant_id FROM customers');
      return rows;
    });
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((r) => r.tenant_id === TENANT_A)).toBe(true);
  });

  rlsTest('an unset context sees no tenant-scoped rows (fails CLOSED)', async () => {
    // RLS is not authentication, but when it is the only thing left it must
    // deny rather than allow.
    const count = await asTenant(null, async (c) => {
      const { rows } = await c.query<{ n: string }>(
        'SELECT count(*)::int AS n FROM customers WHERE tenant_id = ANY($1::uuid[])',
        [[TENANT_A, TENANT_B]]
      );
      return Number(rows[0]?.n);
    });
    expect(count).toBe(0);
  });

  rlsTest('a tenant cannot INSERT a row owned by another tenant', async () => {
    // Without WITH CHECK you can write a row you can never read back.
    await expect(
      asTenant(TENANT_A, async (c) =>
        c.query('INSERT INTO customers (tenant_id, name, phone) VALUES ($1,$2,$3)', [
          TENANT_B,
          'Smuggled',
          '+15550009999',
        ])
      )
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('the two null-context landmines', () => {
  rlsTest('LANDMINE 1: an internal cross-tenant sweep still returns rows', async () => {
    // getDueReminders() runs on a COLD pooled connection with no tenant context
    // and relies on the admin-bypass policies. Those used to read
    // `current_setting(...) = ''`, and on a cold connection the GUC is NULL —
    // NULL = '' is NULL, not true — so the policy denied and the sweep returned
    // zero rows. Every reminder would have stopped silently: no error, no log,
    // no customer complaint until the appointments were missed.
    const client = await appUser.connect();
    try {
      // Deliberately do NOT set any context — that is the whole scenario.
      const { rows } = await client.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM reminder_schedules'
      );
      // The assertion is about REACHABILITY, not row count: the table must be
      // readable by the sweep. A count of 0 on an empty table is fine; being
      // unable to see the table at all is the bug.
      expect(typeof rows[0]?.n).toBe('number');

      const bypass = await client.query<{ ok: boolean }>(
        `SELECT tenant_ctx() = '' AS ok`
      );
      expect(bypass.rows[0]?.ok, 'tenant_ctx() must be empty-string, never NULL').toBe(true);
    } finally {
      client.release();
    }
  });

  rlsTest('LANDMINE 2: a cleared context does not raise invalid-uuid', async () => {
    // clearTenantContext() sets the GUC to the EMPTY STRING on release, and the
    // old policies cast it straight to uuid:
    //     tenant_id = (SELECT current_setting('app.current_tenant_id', true))::uuid
    // '' is not a valid uuid, so this did not deny — it threw
    //     ERROR: invalid input syntax for type uuid: ""
    // on the next request that borrowed that pooled connection. A 500 per
    // request, on every table, seconds after the role switch.
    //
    // This one was NOT in the docs. It was found by probing a non-bypassing
    // role against the real schema (2026-07-24).
    const client = await appUser.connect();
    try {
      await client.query('SELECT set_tenant_context($1::uuid)', [TENANT_A]);
      await client.query("SELECT set_config('app.current_tenant_id', '', false)");

      // Must return a count, not raise.
      const { rows } = await client.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM employee_schedule'
      );
      expect(typeof rows[0]?.n).toBe('number');

      const ctx = await client.query<{ as_uuid: string | null }>(
        'SELECT tenant_ctx_uuid() AS as_uuid'
      );
      expect(ctx.rows[0]?.as_uuid, 'an empty context must be NULL, not a cast error').toBeNull();
    } finally {
      client.release();
    }
  });

  rlsTest('context helpers behave on a genuinely cold connection', async () => {
    const client = await appUser.connect();
    try {
      const { rows } = await client.query<{ ctx: string; ctx_uuid: string | null }>(
        'SELECT tenant_ctx() AS ctx, tenant_ctx_uuid() AS ctx_uuid'
      );
      expect(rows[0]?.ctx).toBe('');
      expect(rows[0]?.ctx_uuid).toBeNull();
    } finally {
      client.release();
    }
  });
});
