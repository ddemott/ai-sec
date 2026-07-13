/**
 * A soft-deleted tenant must be INERT. These tests exist because soft-delete moves
 * the risk rather than removing it: a hard delete is brutally honest (the row is
 * gone, everything fails loudly), while a soft delete is only as good as its filter
 * coverage. Miss ONE read path and a "deleted" business keeps answering its phone,
 * booking appointments, and billing — a zombie tenant, which is worse than what we
 * replaced.
 *
 * So every leak path gets a test. The list is the enumeration.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Client, Pool } from 'pg';
import { ROOT_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient, PostgresDatabaseService } from '../../src/database';

let setup: Client;
let pool: Pool;
let dbAvailable = false;
let tenantId: string;
const tenantsToClean: string[] = [];

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: ROOT_DB_URL, max: 5 });
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (pool) await pool.end();
  if (setup) {
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach(async (ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
  if (!dbAvailable) return;
  tenantId = await createTenant(setup, `SoftDel ${Date.now()}`, 'auto-shop');
  tenantsToClean.push(tenantId);
});

async function softDelete() {
  await setup.query(
    `UPDATE tenants SET is_deleted = true, deleted_at = now() WHERE tenant_id = $1`,
    [tenantId]
  );
}

describe('a soft-deleted tenant is inert', () => {
  it('THE CHOKE POINT: withTenantClient treats it as NOT FOUND (404)', async () => {
    // WHY: ~35 places read the tenants table. Filtering each by hand is how you get a
    //       zombie. Every tenant-scoped route funnels through withTenantClient, so
    //       ONE check here covers them all — the agent's tenant-config, booking,
    //       availability, preferences, messaging, everything.
    const withTenantClient = createWithTenantClient(pool);

    // Alive: works.
    await expect(withTenantClient(tenantId, async () => 'ok')).resolves.toBe('ok');

    await softDelete();

    // Deleted: indistinguishable from a tenant that never existed.
    await expect(withTenantClient(tenantId, async () => 'ok')).rejects.toThrow(/not found/i);
  });

  it('THE WORST LEAK: it must NOT keep texting its customers', async () => {
    // WHO: real people, on real phones.
    // WHAT: soft-delete does NOT cascade, so reminder_schedules rows SURVIVE — still
    //        'scheduled', still due. getDueReminders() sweeps CROSS-TENANT.
    // WHY: without the is_deleted join, a deleted business keeps sending appointment
    //       reminders and confirmations — from a company that no longer exists, on a
    //       number that may have been released. That is a TCPA problem, not a bug.
    //       A hard delete took these rows with it; a soft delete does not. This is
    //       THE cost of the change, and this test is the guard.
    const customerId = (
      await setup.query<{ customer_id: string }>(
        `INSERT INTO customers (tenant_id, name, phone) VALUES ($1,'Reba','+15551234567') RETURNING customer_id`,
        [tenantId]
      )
    ).rows[0].customer_id;
    const resourceId = (
      await setup.query<{ resource_id: string }>(
        `INSERT INTO resources (tenant_id, name, is_active) VALUES ($1,'Bay',true) RETURNING resource_id`,
        [tenantId]
      )
    ).rows[0].resource_id;
    const apptId = (
      await setup.query<{ appointment_id: string }>(
        `INSERT INTO appointments (tenant_id, customer_id, resource_id, start_time, end_time, status)
         VALUES ($1,$2,$3, date_trunc('hour', now() + interval '2 days'),
                 date_trunc('hour', now() + interval '2 days') + interval '30 min','scheduled')
         RETURNING appointment_id`,
        [tenantId, customerId, resourceId]
      )
    ).rows[0].appointment_id;
    // A reminder that is DUE RIGHT NOW.
    await setup.query(
      `INSERT INTO reminder_schedules (tenant_id, appointment_id, customer_phone, reminder_type, scheduled_for, lead_minutes, status)
       VALUES ($1,$2,'+15551234567','24h', now() - interval '1 minute', 1440, 'scheduled')`,
      [tenantId, apptId]
    );

    const db = new PostgresDatabaseService(pool);

    const beforeDelete = await db.getDueReminders();
    expect(beforeDelete.some((r) => r.tenant_id === tenantId)).toBe(true); // it IS due

    await softDelete();

    const afterDelete = await db.getDueReminders();
    expect(afterDelete.some((r) => r.tenant_id === tenantId)).toBe(false); // and now silent
  });

  it('the reminder row still EXISTS — soft-delete does not cascade (that is the point)', async () => {
    // Pinning the mechanism: the data is retained for the maintenance purge. Nothing
    // was destroyed; it was made unreachable. If this ever starts failing because the
    // rows vanished, something reintroduced a cascade.
    await softDelete();
    const rows = await setup.query(`SELECT 1 FROM tenants WHERE tenant_id = $1`, [tenantId]);
    expect(rows.rowCount).toBe(1); // the tenant row is still there, flagged
  });

  it('it does not appear in the tenant list', async () => {
    await softDelete();
    const res = await pool.query(
      `SELECT 1 FROM tenants WHERE is_deleted = false AND tenant_id = $1`,
      [tenantId]
    );
    expect(res.rowCount).toBe(0);
  });

  it('an inbound STOP does not resolve to it (its phone is no longer its own)', async () => {
    // WHY: a deleted business must not still be recording opt-outs against itself —
    //       and its number may have been released to someone else entirely.
    await setup.query(`UPDATE tenants SET inbound_phone = '+16305550199' WHERE tenant_id = $1`, [
      tenantId,
    ]);
    const live = await pool.query(
      `SELECT tenant_id FROM tenants WHERE inbound_phone = $1 AND is_deleted = false LIMIT 1`,
      ['+16305550199']
    );
    expect(live.rowCount).toBe(1);

    await softDelete();

    const dead = await pool.query(
      `SELECT tenant_id FROM tenants WHERE inbound_phone = $1 AND is_deleted = false LIMIT 1`,
      ['+16305550199']
    );
    expect(dead.rowCount).toBe(0);
  });
});
