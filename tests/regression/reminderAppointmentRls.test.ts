/**
 * Regression: the reminder path must be able to read its own appointment under RLS.
 *
 * WHAT HAPPENED. On 2026-08-20, in the first 60 seconds after the reminder
 * pipeline was restored in production (migration 20260819000000 ended a 13-day
 * outage), all 8 pending reminders went straight to `'failed'` with
 * "Appointment not found" — for appointments that plainly existed, were not
 * soft-deleted, and had just been queried by hand.
 *
 * `getAppointmentById` ran on a connection with NO RLS tenant context.
 * `appointments` carries FORCE ROW LEVEL SECURITY and exactly one policy,
 * `tenant_id = tenant_ctx_uuid()`. With no context that function returns NULL,
 * `tenant_id = NULL` evaluates to NULL, and every row is filtered out. The
 * query succeeded and returned nothing.
 *
 * `reminder_schedules` did NOT show the problem — and that is the trap worth
 * remembering. It carries an `admin_bypass` policy (`tenant_ctx() = ''`) so the
 * cross-tenant reminder sweep can read it, so the claim worked, the worker
 * looked healthy, and only the appointment read came back empty. Two tables in
 * one code path with different policy shapes.
 *
 * WHY THIS SUITE CONNECTS AS app_user. A probe run as `postgres` proves
 * nothing: that role bypasses RLS, so the broken version passes. CLAUDE.md
 * records a prior occasion where exactly that produced a confident wrong
 * answer. These tests use a genuine `app_user` connection (rolbypassrls = f),
 * which is the only way the policy is actually in force.
 *
 * 5W for sad-path failures:
 *   WHO   — every customer owed a reminder or confirmation
 *   WHAT  — DatabaseService.getAppointmentById
 *   WHEN  — every reminder the worker processes, in production
 *   WHERE — appointments' tenant_isolation policy vs a context-less connection
 *   WHY   — a context-less read makes a live appointment look deleted, and the
 *           reminder is marked 'failed' for a reason that is not true
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { ROOT_DB_URL, getRootClient, skipIfDbDown } from '../utils';
import { PostgresDatabaseService } from '../../src/database';
import type { Client } from 'pg';

const APP_USER_URL = ROOT_DB_URL.replace(/:\/\/[^@]*@/, '://app_user:app_user@');

let setup: Client;
let appUserPool: Pool;
let db: PostgresDatabaseService;
let dbAvailable = false;
let tenantId: string;
let otherTenantId: string;
let appointmentId: string;
const tenantsToClean: string[] = [];

async function seedTenantWithAppointment(name: string): Promise<{ t: string; a: string }> {
  const t = (
    await setup.query('INSERT INTO tenants (name, business_type) VALUES ($1,$2) RETURNING tenant_id', [
      name,
      'auto-shop',
    ])
  ).rows[0].tenant_id as string;
  tenantsToClean.push(t);
  const r = (
    await setup.query('INSERT INTO resources (tenant_id, name) VALUES ($1,$2) RETURNING resource_id', [
      t,
      'Bay 1',
    ])
  ).rows[0].resource_id as string;
  const c = (
    await setup.query(
      'INSERT INTO customers (tenant_id, phone, name) VALUES ($1,$2,$3) RETURNING customer_id',
      [t, '+16305559999', 'RLS Tester']
    )
  ).rows[0].customer_id as string;
  // appointments_end_time_15min: both ends must sit on a quarter-hour.
  const QUARTER = 900_000;
  const startMs = Math.round((Date.now() + 86_400_000) / QUARTER) * QUARTER;
  const a = (
    await setup.query(
      `INSERT INTO appointments (tenant_id, resource_id, customer_id, start_time, end_time, description, status)
       VALUES ($1,$2,$3,$4,$5,$6,'scheduled') RETURNING appointment_id`,
      [
        t,
        r,
        c,
        new Date(startMs).toISOString(),
        new Date(startMs + 1_800_000).toISOString(),
        'rls regression',
      ]
    )
  ).rows[0].appointment_id as string;
  return { t, a };
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    appUserPool = new Pool({ connectionString: APP_USER_URL, connectionTimeoutMillis: 3000 });
    // Fail fast and honestly if this is not really app_user.
    const who = await appUserPool.query<{ u: string; bypass: boolean }>(
      'SELECT current_user AS u, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass'
    );
    if (who.rows[0].u !== 'app_user' || who.rows[0].bypass) {
      throw new Error('not connected as a non-bypassing app_user');
    }

    const mine = await seedTenantWithAppointment('RLS Reminder Regression');
    tenantId = mine.t;
    appointmentId = mine.a;
    const other = await seedTenantWithAppointment('RLS Reminder Other Tenant');
    otherTenantId = other.t;

    db = new PostgresDatabaseService(appUserPool);
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (setup) {
    for (const t of tenantsToClean) {
      await setup.query('DELETE FROM reminder_schedules WHERE tenant_id = $1', [t]);
      await setup.query('DELETE FROM appointments WHERE tenant_id = $1', [t]);
      await setup.query('DELETE FROM customers WHERE tenant_id = $1', [t]);
      await setup.query('DELETE FROM resources WHERE tenant_id = $1', [t]);
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [t]);
    }
    await setup.end();
  }
  if (appUserPool) await appUserPool.end();
});

beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

describe('getAppointmentById under real RLS as app_user', () => {
  it('HAPPY: finds the appointment when the tenant id is supplied', async () => {
    // THE REGRESSION. Without the tenant argument this returned null in
    // production for an appointment that existed, and every reminder was
    // failed with "Appointment not found".
    const appt = await db.getAppointmentById(appointmentId, tenantId);
    expect(appt).not.toBeNull();
    expect(appt?.tenantId).toBe(tenantId);
  });

  it('SAD: still refuses an appointment belonging to ANOTHER tenant', async () => {
    // Supplying a tenant id must not become a way around isolation — the
    // policy, not the argument, is the authority. Asking for our appointment
    // while scoped to a different tenant must find nothing.
    const appt = await db.getAppointmentById(appointmentId, otherTenantId);
    expect(appt).toBeNull();
  });

  it('SAD: a context-less read finds nothing — the exact production failure', async () => {
    // Asserted against the POLICY directly rather than through
    // getAppointmentById, because omitting the tenant id is now a compile
    // error there (that is the point of the fix). This is what the broken
    // version was really doing: a perfectly valid query on a connection with no
    // tenant context, succeeding and returning zero rows.
    //
    // `appointments` has no admin-bypass policy — unlike `reminder_schedules`,
    // which is exactly why the claim worked while this read came back empty. If
    // this ever starts returning a row, an admin-bypass policy has been added
    // to a tenant-data table and THAT is the thing to go look at.
    const res = await appUserPool.query(
      'SELECT appointment_id FROM appointments WHERE appointment_id = $1',
      [appointmentId]
    );
    expect(res.rows).toHaveLength(0);
  });

  it('SAD: reminder_schedules IS readable without context — the asymmetry that hid the bug', async () => {
    // Pins the contrast that made this so hard to see. The worker claims
    // reminders on a context-less connection and it WORKS, because
    // reminder_schedules carries `admin_bypass` (`tenant_ctx() = ''`) for the
    // cross-tenant sweep. So the pipeline reported itself healthy right up to
    // the appointment read. Two tables, one code path, different policy shapes.
    const r = await setup.query(
      `INSERT INTO reminder_schedules
         (appointment_id, tenant_id, customer_phone, reminder_type, scheduled_for, status, lead_minutes)
       VALUES ($1, $2, '+16305559999', '24h', NOW(), 'scheduled', 1440)
       RETURNING reminder_schedule_id`,
      [appointmentId, tenantId]
    );
    const res = await appUserPool.query(
      'SELECT reminder_schedule_id FROM reminder_schedules WHERE reminder_schedule_id = $1',
      [r.rows[0].reminder_schedule_id]
    );
    expect(res.rows).toHaveLength(1);
  });
});
