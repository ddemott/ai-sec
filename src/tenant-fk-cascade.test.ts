import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Client } from 'pg';
import { getRootClient, skipIfDbDown } from './test-utils';

/**
 * Universal invariant: every foreign key that references `tenants(tenant_id)`
 * must have `ON DELETE CASCADE`.
 *
 * Background: tenant offboarding (`DELETE /tenants/:id` from the super-admin
 * dashboard) is the canonical tenant-data-removal pathway, and it relies
 * ENTIRELY on FK cascade to clean up dependents across the 25+ tenant-scoped
 * tables — the route is just `DELETE FROM tenants WHERE tenant_id = $1`. If
 * any FK to `tenants` lacks CASCADE, one of two things happens at delete
 * time:
 *
 *   1. Hard failure — the DELETE raises `update or delete on table "tenants"
 *      violates foreign key constraint "..."` and the tenant is half-deleted.
 *      That's what `dashboard/e2e/wizard-solo-path.spec.ts` surfaced on
 *      2026-05-12 for `service_employee.tenant_id_fkey` (fixed via migration
 *      `20260513000000`).
 *   2. Soft failure — if the constraint is `NOT VALID` or the row is
 *      already orphaned, the table silently retains rows pointing at a
 *      dead `tenant_id`. That's what surfaced for `employees` + `services`
 *      on 2026-05-11 (77 orphan employees + 8 orphan services accumulated;
 *      fixed via migration `20260511000000`).
 *
 * Both failure modes broke the implicit "delete the tenant, delete the data"
 * contract that GDPR posture relies on. Rather than adding a per-table test
 * each time a new tenant-scoped table ships, this file asserts the SCHEMA-WIDE
 * invariant: ANY FK pointing at `tenants` with anything other than
 * `confdeltype = 'c'` is a bug.
 *
 * Bonus: a regression where someone adds a new tenant-scoped table but
 * forgets the CASCADE clause fails THIS test, not "the next tenant
 * delete that happens to involve that table." Catch the bug at migration
 * time, not at offboarding time.
 */

describe('Schema invariant: every FK to tenants(tenant_id) has ON DELETE CASCADE', () => {
  let root: Client;
  let dbAvailable = true;
  beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

  beforeAll(async () => {
    try {
      root = await getRootClient();
    } catch (err) {
      dbAvailable = false;
      // eslint-disable-next-line no-console
      console.warn('[tenant-fk-cascade.test] Skipping DB tests - connection failed', err);
    }
  });

  afterAll(async () => {
    if (dbAvailable && root) await root.end();
  });

  it('every FK referencing tenants is ON DELETE CASCADE — zero non-CASCADE rows allowed', async () => {
    // WHO: schema introspection over pg_constraint; any FK whose `confrelid`
    //      points at `tenants`.
    // WHAT: the query returns zero rows. Each returned row is a constraint
    //       that would silently break tenant offboarding.
    // WHEN: every schema migration. Hard-coded into CI by living in src/.
    // WHERE: pg_constraint.confdeltype — 'c' means CASCADE, anything else
    //        (default 'a' = no action, 'r' = restrict, 'n' = set null,
    //        'd' = set default) is a bug here.
    // WHY: prefer ONE schema-wide assertion over N per-table assertions. A
    //      new tenant-scoped table that ships without CASCADE will appear in
    //      this query result — the test fails LOUD with the offending table
    //      and constraint name surfaced in the error message, making the
    //      diagnosis self-contained.
    if (!dbAvailable) return;

    const result = await root.query<{
      table_name: string;
      constraint_name: string;
      delete_action: string;
    }>(`
            SELECT
                conrelid::regclass::text AS table_name,
                conname AS constraint_name,
                CASE confdeltype
                    WHEN 'c' THEN 'CASCADE'
                    WHEN 'a' THEN 'NO ACTION'
                    WHEN 'r' THEN 'RESTRICT'
                    WHEN 'n' THEN 'SET NULL'
                    WHEN 'd' THEN 'SET DEFAULT'
                END AS delete_action
            FROM pg_constraint
            WHERE contype = 'f'
              AND confrelid = 'public.tenants'::regclass
              AND confdeltype != 'c'
            ORDER BY conrelid::text, conname
        `);

    // Surface the offending rows in the failure message so a regression
    // tells you EXACTLY which table needs fixing.
    const violations = result.rows.map(
      (r) => `  ${r.table_name}.${r.constraint_name} → ${r.delete_action}`
    );
    const message =
      violations.length === 0
        ? 'all tenant FKs are CASCADE — invariant holds'
        : `Non-CASCADE FK(s) referencing tenants — tenant offboarding will fail or leak rows:\n${violations.join('\n')}`;
    expect(result.rows, message).toHaveLength(0);
  });

  it('HAPPY: known-good FKs are CASCADE — explicit per-table pins for the historically broken ones', async () => {
    // WHO: schema regression detector for the four tables whose CASCADE has
    //      been broken at least once historically.
    // WHAT: each of `employees`, `services`, `service_employee`,
    //       `service_resource` has its `tenant_id_fkey` recorded as 'c'.
    // WHEN: defense-in-depth. The universal invariant test above would
    //       catch a regression on any of these too, but explicit per-table
    //       pins make the failure mode obvious in CI output: "if this
    //       specific table's constraint regressed, you'll see THIS test
    //       fail with a name you can grep."
    // WHERE: pg_constraint, joined on table + constraint name.
    // WHY: the universal test surfaces the symptom (some FK lacks CASCADE).
    //      This test surfaces the FIX SHAPE (migration `20260513000000` for
    //      service_employee; `20260511000000` for employees + services; and
    //      `20260309000002` table-recreate for service_resource). If any of
    //      these revert, this test fails with a self-explanatory name —
    //      easier for a future maintainer than a 26-row dump.
    if (!dbAvailable) return;

    const PINNED = [
      { table: 'employees', constraint: 'employees_tenant_id_fkey' },
      { table: 'services', constraint: 'services_tenant_id_fkey' },
      { table: 'service_employee', constraint: 'service_employee_tenant_id_fkey' },
      { table: 'service_resource', constraint: 'service_resource_tenant_id_fkey' },
    ];

    for (const { table, constraint } of PINNED) {
      const result = await root.query<{ confdeltype: string }>(
        `SELECT confdeltype FROM pg_constraint
                 WHERE conname = $1 AND conrelid = $2::regclass`,
        [constraint, table]
      );
      expect(
        result.rows[0]?.confdeltype,
        `${table}.${constraint} must be ON DELETE CASCADE (confdeltype='c')`
      ).toBe('c');
    }
  });

  it('SAD: cascade actually fires when a tenant is deleted — service_employee row is removed', async () => {
    // WHO: tenant-offboarding flow (super-admin DELETE /tenants/:id, or any
    //      future bulk-data-deletion path). Specifically the
    //      service_employee row — the one fixed by migration `20260513000000`.
    // WHAT: insert a tenant with full chain (service + employee + mapping
    //       row), DELETE the tenant, assert the service_employee row is
    //       gone via a follow-up SELECT.
    // WHEN: every offboarding. A schema-shape assertion (test 1 + test 2)
    //       proves CASCADE is DECLARED; this behavioral test proves CASCADE
    //       actually FIRES end-to-end on real Postgres.
    // WHERE: pg's enforcement of confdeltype='c' at DELETE time.
    // WHY: a constraint can be DECLARED CASCADE but DISABLED, or DEFERRED,
    //      or have a trigger that suppresses it — the only honest test is
    //      to actually delete the parent and watch what happens to the
    //      child. Catches a regression where CASCADE is declared but the
    //      mechanism is sabotaged in some non-obvious way.
    if (!dbAvailable) return;

    const tenant = await root.query<{ tenant_id: string }>(
      "INSERT INTO tenants (name, business_type) VALUES ('CascadeProbeTenant', 'automotive') RETURNING tenant_id"
    );
    const tenantId = tenant.rows[0].tenant_id;
    const service = await root.query<{ service_id: string }>(
      "INSERT INTO services (tenant_id, name, duration_minutes) VALUES ($1, 'Probe Service', 30) RETURNING service_id",
      [tenantId]
    );
    const employee = await root.query<{ employee_id: string }>(
      "INSERT INTO employees (tenant_id, name, first_name, last_name) VALUES ($1, 'Probe', 'Probe', 'Worker') RETURNING employee_id",
      [tenantId]
    );
    await root.query(
      'INSERT INTO service_employee (tenant_id, service_id, employee_id) VALUES ($1, $2, $3)',
      [tenantId, service.rows[0].service_id, employee.rows[0].employee_id]
    );

    // Sanity: the row was inserted.
    const before = await root.query('SELECT 1 FROM service_employee WHERE tenant_id = $1', [
      tenantId,
    ]);
    expect(before.rowCount).toBe(1);

    // The actual test: tenant DELETE must cascade to service_employee
    // without raising an FK violation.
    await root.query('DELETE FROM tenants WHERE tenant_id = $1', [tenantId]);

    const after = await root.query('SELECT 1 FROM service_employee WHERE tenant_id = $1', [
      tenantId,
    ]);
    expect(after.rowCount).toBe(0);
  });
});
