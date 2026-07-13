/**
 * DETERMINISTIC REPRO of the E2E teardown deadlock (PR #242, CI run 29220656800).
 *
 * `industry-templates.spec.ts` books an appointment, then deletes its tenant. One
 * run in two, the DELETE dies with `deadlock detected`. It looks like flake. It is
 * not — it is a genuine AB-BA lock cycle, and it can bite production too.
 *
 * THE CYCLE:
 *
 *   Booking routes seed reminders FIRE-AND-FORGET:
 *       void scheduleRemindersForAppointment(...)      // agentTools/scheduling.ts
 *   so the INSERT into reminder_schedules is still running AFTER the HTTP response
 *   has returned and the test has moved on to teardown.
 *
 *   That INSERT needs FK locks:   tenants(T) ──KEY SHARE──▶  appointments(A) KEY SHARE
 *   The cascading DELETE needs:   appointments(A) ──EXCLUSIVE──▶ tenants(T) EXCLUSIVE
 *
 *   Opposite order. Each waits on what the other holds. Postgres kills one at random
 *   — which is why the DELETE fails only sometimes, and why it reads as flake.
 *
 * This test forces the interleaving with two clients and explicit lock statements,
 * so it fails 100% of the time rather than 50%.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type Client, Pool, type PoolClient } from 'pg';
import {
  ROOT_DB_URL,
  getRootClient,
  createTenant,
  createCustomer,
  skipIfDbDown,
  deleteTenantWithDeadlockRetry,
} from '../utils';

let setup: Client;
let pool: Pool;
let dbAvailable = false;
let tenantId: string;
let appointmentId: string;
const tenantsToClean: string[] = [];

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    // ROOT, not api_user. The E2E harness deletes tenants as the owning role, and
    // more importantly api_user is subject to RLS: with no tenant context set, its
    // DELETE FROM appointments matches ZERO rows, takes no locks, and no deadlock can
    // form. The first version of this test used api_user and "proved" there was no
    // bug — a false negative created by RLS quietly making the statement a no-op.
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

/** A tenant with one appointment — the state the E2E test is in at teardown. */
async function seedBookedTenant() {
  tenantId = await createTenant(setup, `Deadlock Co ${Date.now()}`, 'auto-shop');
  tenantsToClean.push(tenantId);
  const customerId = await createCustomer(setup, tenantId, 'Booked Bev', '+15551230000');
  const res = await setup.query<{ resource_id: string }>(
    `INSERT INTO resources (tenant_id, name, is_active) VALUES ($1,'Bay 1',true) RETURNING resource_id`,
    [tenantId]
  );
  const appt = await setup.query<{ appointment_id: string }>(
    // Appointments are constrained to the 15-minute clock grid
    // (appointments_end_time_15min), so snap the fixture to it.
    `INSERT INTO appointments (tenant_id, customer_id, resource_id, start_time, end_time, status)
     VALUES ($1, $2, $3,
             date_trunc('hour', now() + interval '2 days'),
             date_trunc('hour', now() + interval '2 days') + interval '30 minutes',
             'scheduled')
     RETURNING appointment_id`,
    [tenantId, customerId, res.rows[0].resource_id]
  );
  appointmentId = appt.rows[0].appointment_id;
}

describe('tenant-delete vs fire-and-forget reminder seeding (deadlock)', () => {
  it('REPRO: the cascade DELETE and the reminder INSERT deadlock — deterministically', async (ctx) => {
    skipIfDbDown(ctx, () => dbAvailable);
    if (!dbAvailable) return;
    await seedBookedTenant();

    const seeder: PoolClient = await pool.connect(); // plays scheduleRemindersForAppointment
    const deleter: PoolClient = await pool.connect(); // plays the E2E teardown

    let deadlockedSide: string | null = null;

    try {
      await seeder.query('BEGIN');
      await deleter.query('BEGIN');

      // SEEDER takes the tenant lock first (the FK check reminder_schedules.tenant_id
      // → tenants does exactly this).
      await seeder.query('SELECT 1 FROM tenants WHERE tenant_id = $1 FOR KEY SHARE', [tenantId]);

      // DELETER takes the appointment lock first (the cascade reaches appointments
      // before it reaches the tenant row itself).
      await deleter.query('DELETE FROM appointments WHERE appointment_id = $1', [appointmentId]);

      // Now each reaches for what the other holds. Postgres will kill one.
      const seederWaits = seeder
        .query(
          `INSERT INTO reminder_schedules
             (tenant_id, appointment_id, customer_phone, reminder_type, scheduled_for, lead_minutes, status)
           VALUES ($1, $2, '+15551230000', '24h', now() + interval '1 day', 1440, 'scheduled')`,
          [tenantId, appointmentId]
        )
        .then(() => null)
        .catch((e: { code?: string }) => (e.code === '40P01' ? 'seeder' : null));

      const deleterWaits = deleter
        .query('DELETE FROM tenants WHERE tenant_id = $1', [tenantId])
        .then(() => null)
        .catch((e: { code?: string }) => (e.code === '40P01' ? 'deleter' : null));

      const [a, b] = await Promise.all([seederWaits, deleterWaits]);
      deadlockedSide = a ?? b;
    } finally {
      await seeder.query('ROLLBACK').catch(() => {});
      await deleter.query('ROLLBACK').catch(() => {});
      seeder.release();
      deleter.release();
    }

    // THE PROOF. Postgres detected a genuine lock cycle and killed one side.
    // 40P01 = deadlock_detected. Which side loses is arbitrary — that arbitrariness
    // IS the "flake". In CI it was the DELETE, and the E2E teardown blew up.
    expect(deadlockedSide).not.toBeNull();
    expect(['seeder', 'deleter']).toContain(deadlockedSide);
  }, 20000);

  it('THE FIX: retrying the loser on 40P01 makes the delete succeed every time', async (ctx) => {
    skipIfDbDown(ctx, () => dbAvailable);
    if (!dbAvailable) return;
    await seedBookedTenant();

    // Same race, but the DELETE side now retries on deadlock instead of dying.
    // Retry is the correct remedy: a deadlock is a TRANSIENT scheduling accident,
    // not a logic error — one side is killed precisely so the other can proceed, and
    // the killed statement is valid the moment it is tried again.
    const seeder: PoolClient = await pool.connect();
    try {
      await seeder.query('BEGIN');
      await seeder.query('SELECT 1 FROM tenants WHERE tenant_id = $1 FOR KEY SHARE', [tenantId]);

      // The delete races the held lock, may deadlock, and retries through it.
      const deleted = deleteTenantWithDeadlockRetry(pool, tenantId);

      // Let the seeder finish and release, as the real fire-and-forget insert would.
      await seeder
        .query(
          `INSERT INTO reminder_schedules
             (tenant_id, appointment_id, customer_phone, reminder_type, scheduled_for, lead_minutes, status)
           VALUES ($1, $2, '+15551230000', '24h', now() + interval '1 day', 1440, 'scheduled')`,
          [tenantId, appointmentId]
        )
        .catch(() => {
          /* may be the deadlock victim — that's fine, it's fire-and-forget */
        });
      await seeder.query('COMMIT').catch(() => seeder.query('ROLLBACK'));

      await expect(deleted).resolves.toBe(true);
    } finally {
      seeder.release();
    }

    const gone = await setup.query('SELECT 1 FROM tenants WHERE tenant_id = $1', [tenantId]);
    expect(gone.rowCount).toBe(0);
  }, 30000);
});
