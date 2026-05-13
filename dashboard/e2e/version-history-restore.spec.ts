/**
 * E2E coverage for the soft-delete → restore lifecycle through the
 * version-history routes. Pins the contract that "we accidentally
 * deleted X — restore it" actually works end-to-end against the
 * `restore_deleted_record` RPC and the dashboard's visibility filters.
 *
 * Why this exists: `docs/TODO.md` P2 "Version-history restore for a
 * soft-deleted record — critical for the customer-trust scenario."
 * The RPC has unit tests, the route has unit tests, but nothing pins
 * the round-trip: when an operator soft-deletes a customer and then
 * restores it five minutes later, does the customer actually reappear
 * in the same places they were before? If `customers` GET silently
 * leaks a `WHERE is_deleted = false` filter in a future refactor, OR
 * if `restore_deleted_record` stops actually flipping is_deleted back
 * to false, the customer is "restored" by API but invisible to the
 * operator — worst possible UX for a trust scenario.
 *
 * Three tests:
 *   1. HAPPY round-trip — create customer → soft-delete → confirm
 *      removed from `/customers` list + appears in `/records/customers/
 *      deleted` → restore → confirm reappears in `/customers` + drops
 *      out of the deleted list.
 *   2. SAD non-deleted — POST /restore against a record that's never
 *      been deleted returns 404 + error_code RECORD_NOT_DELETED. The
 *      record's state must be unchanged.
 *   3. SAD invalid table — POST /restore against a table not in the
 *      VERSIONED_TABLES whitelist (e.g. `foobar`, `tenants`,
 *      `password_resets`) returns 400 + error_code INVALID_TABLE. No
 *      DB call must run. Pins the SQL-injection-defense boundary
 *      (the route inlines the table name into the SQL string).
 *
 * API-only design — the dashboard's UI surfaces (DeletedRecordsPanel,
 * RecordHistoryModal "Restore" button) are component-tested separately;
 * this spec pins the backend contract those components depend on.
 */
import { test, expect } from './helpers/test';
import { type APIRequestContext } from '@playwright/test';
import { Pool } from 'pg';
import {
  BACKEND_URL,
  PG_URL,
  registerFreshTenant,
  createCustomerAs,
  cleanTenantData,
  type RegisteredTenant,
} from './helpers/fixtures';

let pool: Pool;

test.beforeAll(() => {
  pool = new Pool({ connectionString: PG_URL });
});
test.afterAll(async () => {
  await pool.end();
});

async function softDeleteAs(
  req: APIRequestContext,
  token: string,
  table: string,
  recordId: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await req.post(`${BACKEND_URL}/records/${table}/${recordId}/soft-delete`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    data: { deleted_by: 'e2e-test', change_source: 'local' },
  });
  return { status: res.status(), body: await res.json() };
}

async function restoreAs(
  req: APIRequestContext,
  token: string,
  table: string,
  recordId: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await req.post(`${BACKEND_URL}/records/${table}/${recordId}/restore`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    data: { restored_by: 'e2e-test', change_source: 'local' },
  });
  return { status: res.status(), body: await res.json() };
}

async function listCustomersAs(
  req: APIRequestContext,
  token: string,
  tenantId: string
): Promise<Array<{ customer_id: string; name: string }>> {
  const res = await req.get(`${BACKEND_URL}/customers?tenant_id=${tenantId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status(), 'list customers must succeed').toBe(200);
  const body = await res.json();
  // GET /customers returns the array directly (not wrapped in success/data).
  // Rows shaped with `customer_id` (post-pilot-15 rename), not bare `id`.
  return Array.isArray(body) ? body : [];
}

async function listDeletedCustomersAs(
  req: APIRequestContext,
  token: string,
  tenantId: string
): Promise<{ records: Array<{ record_id: string; name: string }>; total: number }> {
  const res = await req.get(`${BACKEND_URL}/records/customers/deleted?tenant_id=${tenantId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status(), 'list deleted customers must succeed').toBe(200);
  // The /records/:table/deleted route deliberately aliases the table's
  // PK column (customer_id, employee_id, etc.) to `record_id` so all
  // soft-deletable tables produce one consistent response shape. The
  // dashboard DeletedRecordsPanel reads `.record_id` for the same reason.
  return await res.json();
}

// ────────────────────────────────────────────────────────────────────────────
// 1. HAPPY: full soft-delete → restore round-trip
// ────────────────────────────────────────────────────────────────────────────
test('restore-happy: soft-deleted customer disappears from the list and comes back exactly when restored', async ({ request }) => {
  // WHO: operator who accidentally deleted a customer and clicks Restore
  //       from the deleted-records panel five minutes later (or the
  //       customer themselves asks "why am I gone from your system").
  // WHAT: create customer → POST /soft-delete → customer is filtered
  //       out of GET /customers AND appears in GET /records/customers/
  //       deleted. Then POST /restore flips is_deleted back to false →
  //       customer reappears in GET /customers AND drops out of the
  //       deleted list. Net: complete state-cycle round-trip.
  // WHEN: any restore-from-deletion flow — the only path to undo a
  //       soft-delete.
  // WHERE: `restore_deleted_record($1, $2, $3, $4, $5)` Postgres RPC
  //       called by `POST /records/:table/:recordId/restore`, paired
  //       with the `is_deleted = false` filter in `/customers` SELECT.
  // WHY: this is the "trust scenario" the TODO calls out. If a future
  //       refactor breaks the round-trip — most likely failure modes:
  //       (a) `restore_deleted_record` returns true but doesn't
  //       actually UPDATE is_deleted (silent regression in the RPC's
  //       SQL); (b) `/customers` keeps a stale cache; (c) the deleted-
  //       list query stops filtering on `is_deleted = true` so it
  //       shows everything — the operator would have no in-app way to
  //       know whether the restore succeeded. This test pins all three
  //       observable assertions in one go: gone from active, present
  //       in deleted, back in active after restore, gone from deleted
  //       after restore.
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const customerId = await createCustomerAs(
      request,
      tenant.token,
      tenant.tenantId,
      'Restore Test Customer'
    );

    // Pre-delete: customer in the active list, deleted list empty
    let active = await listCustomersAs(request, tenant.token, tenant.tenantId);
    let deleted = await listDeletedCustomersAs(request, tenant.token, tenant.tenantId);
    expect(active.find((c) => c.customer_id === customerId), 'customer should be in active list before delete').toBeTruthy();
    expect(deleted.records.find((c) => c.record_id === customerId), 'customer should NOT be in deleted list before delete').toBeFalsy();

    // Soft-delete
    const del = await softDeleteAs(request, tenant.token, 'customers', customerId);
    expect(del.status, `soft-delete must succeed; body=${JSON.stringify(del.body)}`).toBe(200);
    expect(del.body.success).toBe(true);

    // Post-delete: filtered out of active, present in deleted
    active = await listCustomersAs(request, tenant.token, tenant.tenantId);
    deleted = await listDeletedCustomersAs(request, tenant.token, tenant.tenantId);
    expect(active.find((c) => c.customer_id === customerId), 'customer should be filtered from active list after delete').toBeFalsy();
    expect(deleted.records.find((c) => c.record_id === customerId), 'customer should appear in deleted list after delete').toBeTruthy();
    expect(deleted.total, 'deleted total should be at least 1').toBeGreaterThanOrEqual(1);

    // Restore
    const restored = await restoreAs(request, tenant.token, 'customers', customerId);
    expect(restored.status, `restore must succeed; body=${JSON.stringify(restored.body)}`).toBe(200);
    expect(restored.body.success).toBe(true);

    // Post-restore: back in active, gone from deleted
    active = await listCustomersAs(request, tenant.token, tenant.tenantId);
    deleted = await listDeletedCustomersAs(request, tenant.token, tenant.tenantId);
    expect(active.find((c) => c.customer_id === customerId), 'customer should be back in active list after restore').toBeTruthy();
    expect(deleted.records.find((c) => c.record_id === customerId), 'customer should be gone from deleted list after restore').toBeFalsy();
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 2. SAD: restore on a never-deleted record returns 404 RECORD_NOT_DELETED
// ────────────────────────────────────────────────────────────────────────────
test('restore-not-deleted: POST /restore on a record that was never deleted returns 404 + RECORD_NOT_DELETED', async ({ request }) => {
  // WHO: stale UI clicks Restore on a record another session just
  //       restored (or never deleted in the first place) — and the
  //       deleted-records list got out of sync between fetch and click.
  // WHAT: the `restore_deleted_record` RPC returns false when the
  //       target record's is_deleted is already false; the route maps
  //       that to a 404 + error_code 'RECORD_NOT_DELETED'. State must
  //       be unchanged.
  // WHEN: any restore attempt on a non-deleted record.
  // WHERE: `if (!restored)` branch in the restore route.
  // WHY: the distinction matters for UI: 404 + RECORD_NOT_DELETED means
  //       "your view is stale, refresh and you'll see this record is
  //       already active" — different from 404 with no code (the record
  //       doesn't exist at all) which would warrant removing the row
  //       from the deleted-list pane. Pinning the code keeps the
  //       error_code contract stable for consumers.
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const customerId = await createCustomerAs(
      request,
      tenant.token,
      tenant.tenantId,
      'Never Deleted Customer'
    );

    // Pre-condition: customer is NOT deleted
    const active = await listCustomersAs(request, tenant.token, tenant.tenantId);
    expect(active.find((c) => c.customer_id === customerId)).toBeTruthy();

    const restored = await restoreAs(request, tenant.token, 'customers', customerId);
    expect(restored.status, `expected 404; body=${JSON.stringify(restored.body)}`).toBe(404);
    expect(restored.body).toMatchObject({
      code: 'RECORD_NOT_DELETED',
    });

    // Post-condition: customer state unchanged — still in active list,
    // still not in deleted list. The 404 fires without flipping any bit.
    const stillActive = await listCustomersAs(request, tenant.token, tenant.tenantId);
    expect(stillActive.find((c) => c.customer_id === customerId), 'customer must remain active after rejected restore').toBeTruthy();
    const deleted = await listDeletedCustomersAs(request, tenant.token, tenant.tenantId);
    expect(deleted.records.find((c) => c.record_id === customerId), 'customer must NOT be in deleted list').toBeFalsy();
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 3. SAD: restore on an invalid table name returns 400 INVALID_TABLE
// ────────────────────────────────────────────────────────────────────────────
test('restore-invalid-table: POST /restore against a non-versioned table returns 400 + INVALID_TABLE before any SQL runs', async ({ request }) => {
  // WHO: a malicious or buggy caller hitting the route with an
  //       arbitrary table name — `tenants`, `password_resets`, `foobar`.
  // WHAT: the validateTable Zod gate rejects with 400 + error_code
  //       'INVALID_TABLE' before any DB call runs. Critical because
  //       the restore route inlines the table name directly into the
  //       SQL string passed to the RPC; without the whitelist gate, a
  //       caller could try to flip is_deleted on any table the RLS
  //       policy lets them through.
  // WHEN: any restore attempt against a table not in the
  //       VERSIONED_TABLES whitelist (customers, appointments,
  //       voice_sessions, employees, services, resources).
  // WHERE: validateTable() → TableNameSchema z.enum check at the top
  //       of the restore handler.
  // WHY: defense-in-depth — pinning this as an E2E (not just a route
  //       unit test) ensures the gate fires through the full request
  //       stack including auth + tenant middleware, not just under
  //       Fastify.inject() with synthetic auth. If a refactor moves
  //       the validateTable call below tenant context setup, or
  //       skips it for one verb of the endpoint, this catches it.
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);

    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request.post(
      `${BACKEND_URL}/records/foobar/${fakeId}/restore`,
      {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tenant.token}` },
        data: { restored_by: 'e2e-test' },
      }
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      code: 'INVALID_TABLE',
    });

    // Also reject `tenants` — a real table name but NOT versioned, the
    // most dangerous gap if the whitelist were ever bypassed.
    const tenantsRes = await request.post(
      `${BACKEND_URL}/records/tenants/${fakeId}/restore`,
      {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tenant.token}` },
        data: { restored_by: 'e2e-test' },
      }
    );
    expect(tenantsRes.status()).toBe(400);
    const tenantsBody = await tenantsRes.json();
    expect(tenantsBody).toMatchObject({ code: 'INVALID_TABLE' });
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});
