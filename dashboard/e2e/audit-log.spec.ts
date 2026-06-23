/**
 * E2E for GET /audit-log — proves the audit trigger fires end-to-end, including
 * the 2026-06-22 extension to services + employees.
 *
 * WHO:   business owner reviewing the change history (Setup → Audit Log)
 * WHAT:  creating + updating a service writes INSERT/UPDATE rows to audit_log
 *        (via fn_audit_trigger), and GET /audit-log?table_name=services returns
 *        them, scoped to the tenant.
 * WHERE: supabase migration 20260622000000 (trigger on services/employees) +
 *        src/routes/auditLog.ts.
 * WHY:   the trigger is DB-side — only a real-DB E2E proves a service edit
 *        actually lands in the audit log (the route unit test is mocked, and the
 *        trigger only exists if the migration ran against the test DB).
 *
 * Runs against the baseline-built E2E DB (globalSetup applies baseline.sql,
 * which now includes the services/employees triggers).
 */
import { test, expect } from './helpers/test';
import { Pool } from 'pg';
import {
  BACKEND_URL,
  PG_URL,
  registerFreshTenant,
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

test('audit-log-services: creating + updating a service writes audit rows', async ({ request }) => {
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${tenant.token}` };

    // Create a service → INSERT fires the audit trigger.
    const createRes = await request.post(`${BACKEND_URL}/services/create`, {
      headers: hdr,
      data: { tenant_id: tenant.tenantId, name: 'E2E Audit Service', duration_minutes: 30 },
    });
    expect(createRes.status()).toBe(200);
    const created = await createRes.json();
    const serviceId: string = created.service?.service_id ?? created.service_id;
    expect(serviceId, 'service create must return a service_id').toBeTruthy();

    // Update its price → UPDATE fires the audit trigger.
    const updRes = await request.post(`${BACKEND_URL}/services/${serviceId}/update`, {
      headers: hdr,
      data: { tenant_id: tenant.tenantId, price: 99.99 },
    });
    expect(updRes.status()).toBe(200);

    // The owner-facing audit log surfaces both, filtered to services.
    const logRes = await request.get(
      `${BACKEND_URL}/audit-log?tenant_id=${tenant.tenantId}&table_name=services`,
      { headers: hdr }
    );
    expect(logRes.status()).toBe(200);
    const body = await logRes.json();
    expect(body.success).toBe(true);

    const mine = body.entries.filter(
      (e: { record_id: string; table_name: string }) =>
        e.record_id === serviceId && e.table_name === 'services'
    );
    expect(mine.length, 'service edits must appear in the audit log').toBeGreaterThanOrEqual(2);
    const actions = mine.map((e: { action: string }) => e.action);
    expect(actions, 'create logs an INSERT').toContain('INSERT');
    expect(actions, 'price change logs an UPDATE').toContain('UPDATE');

    // The UPDATE row carries the new price in its new_data snapshot (numeric may
    // serialize as a JSON number or string depending on pg — compare loosely).
    const updateRow = mine.find((e: { action: string }) => e.action === 'UPDATE');
    expect(Number(updateRow.new_data.price)).toBe(99.99);
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});
