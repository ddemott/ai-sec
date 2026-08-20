/**
 * Regression: the reminder worker's atomic claim must actually work against real
 * Postgres, and a claimed reminder must remain processable.
 *
 * WHY THIS SUITE IS REAL-DB AND NOT MOCKED. On 2026-08-06 (#322) the worker
 * gained an atomic claim — `UPDATE ... SET status = 'sending' ... FOR UPDATE SKIP
 * LOCKED` — to stop a double-text on every Railway deploy. It was a correct fix
 * for a real bug, it shipped with unit tests, and it took the ENTIRE reminder
 * pipeline down for 13 days, because `reminder_schedules_status_check` did not
 * allow 'sending'. Every tick threw, the exception was caught by processBatch's
 * outer handler, and the worker went on reporting itself healthy.
 *
 * Not one existing test could have caught it. They all mock the pool, and a mock
 * has no CHECK constraints. This suite exists to hold the line at the only place
 * the bug was ever visible: a real INSERT and UPDATE against real Postgres.
 *
 * 5W for sad-path failures:
 *   WHO   — every customer owed a confirmation or reminder
 *   WHAT  — the claim UPDATE in src/workers/reminderScheduler.ts processBatch()
 *   WHEN  — every 60s tick, in prod
 *   WHERE — reminder_schedules.status + reminder_schedules_status_check
 *   WHY   — a status the worker writes but the constraint rejects takes the whole
 *           pipeline down silently; a status the constraint allows but
 *           processReminder refuses strands the row where nothing looks again
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Client, Pool } from 'pg';
import {
  ROOT_DB_URL,
  getRootClient,
  createTenant,
  createResource,
  createCustomerFull,
  createAppointment,
  skipIfDbDown,
} from '../utils';
import { releaseStaleClaims } from '../../src/workers/reminderScheduler';

// The exact statement processBatch() runs. Kept verbatim so a divergence between
// this suite and the worker shows up as a failing test rather than a green suite
// guarding code nobody runs.
const CLAIM_SQL = `
  UPDATE reminder_schedules
     SET status = 'sending',
         updated_at = NOW()
   WHERE reminder_schedule_id IN (
     SELECT reminder_schedule_id
       FROM reminder_schedules
      WHERE status = 'scheduled'
        AND scheduled_for <= NOW()
      ORDER BY scheduled_for ASC, reminder_schedule_id ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
   )
   RETURNING *
`;

let setup: Client;
let pool: Pool;
let dbAvailable = false;
let tenantId: string;
let appointmentId: string;
const tenantsToClean: string[] = [];

async function seedReminder(status = 'scheduled', minutesAgo = 1): Promise<number> {
  const res = await setup.query(
    `INSERT INTO reminder_schedules
       (appointment_id, tenant_id, customer_phone, reminder_type, scheduled_for, status, lead_minutes, updated_at)
     VALUES ($1, $2, '+16305551212', '24h', NOW() - ($3::int * interval '1 minute'), $4, 1440,
             NOW() - ($3::int * interval '1 minute'))
     RETURNING reminder_schedule_id`,
    [appointmentId, tenantId, minutesAgo, status]
  );
  return res.rows[0].reminder_schedule_id as number;
}

async function statusOf(id: number): Promise<string> {
  const res = await setup.query(
    'SELECT status FROM reminder_schedules WHERE reminder_schedule_id = $1',
    [id]
  );
  return res.rows[0]?.status as string;
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    pool = new Pool({ connectionString: ROOT_DB_URL });

    tenantId = await createTenant(setup, 'Reminder Claim Regression', 'auto-shop');
    tenantsToClean.push(tenantId);
    const resourceId = await createResource(setup, tenantId, 'Bay 1');
    const customerId = await createCustomerFull(setup, tenantId, '+16305551212', 'Claim Tester');
    // appointments_end_time_15min: both ends must land on a quarter-hour.
    const QUARTER = 900_000;
    const startMs = Math.round((Date.now() + 86_400_000) / QUARTER) * QUARTER;
    const start = new Date(startMs).toISOString();
    const end = new Date(startMs + 1_800_000).toISOString();
    appointmentId = await createAppointment(
      setup,
      tenantId,
      resourceId,
      customerId,
      start,
      end,
      'claim regression'
    );

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
  if (pool) await pool.end();
});

beforeEach(async (ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
  if (dbAvailable) {
    await setup.query('DELETE FROM reminder_schedules WHERE tenant_id = $1', [tenantId]);
  }
});

describe('reminder atomic claim — real Postgres', () => {
  it("HAPPY: the claim moves a due reminder to 'sending' without violating the status constraint", async () => {
    // THE REGRESSION. This is the exact statement that threw
    // "violates check constraint reminder_schedules_status_check" on every tick
    // for 13 days. If migration 20260819000000 is ever reverted, this fails here
    // instead of in production.
    const id = await seedReminder('scheduled');

    const res = await pool.query(CLAIM_SQL, [100]);

    expect(res.rows.map((r) => Number(r.reminder_schedule_id))).toContain(id);
    expect(await statusOf(id)).toBe('sending');
  });

  it("SAD: 'sending' is a real enum member, not a value the constraint tolerates by accident", async () => {
    // Guards the widening from being over-broad. A constraint rewritten as a
    // no-op (or dropped outright) would let the happy path above pass while
    // silently accepting garbage.
    const id = await seedReminder('scheduled');
    await expect(
      setup.query('UPDATE reminder_schedules SET status = $1 WHERE reminder_schedule_id = $2', [
        // must fit varchar(20) — a longer value would trip the length check
        // first and prove nothing about the enum
        'bogus_status',
        id,
      ])
    ).rejects.toThrow(/reminder_schedules_status_check/);
  });

  it('SAD: a second claim cannot re-claim a row the first claim already took', async () => {
    // The whole point of the claim: two workers (or two ticks) must not both
    // hand the same reminder to Telnyx. That was a double-text on every deploy.
    const id = await seedReminder('scheduled');

    const first = await pool.query(CLAIM_SQL, [100]);
    const second = await pool.query(CLAIM_SQL, [100]);

    expect(first.rows.map((r) => Number(r.reminder_schedule_id))).toContain(id);
    expect(second.rows.map((r) => Number(r.reminder_schedule_id))).not.toContain(id);
  });
});

describe('stale claim recovery — real Postgres', () => {
  it('HAPPY: a reminder abandoned in sending is put back on the queue', async () => {
    // A worker that dies after claiming (SIGTERM past the drain, OOM, eviction)
    // leaves the row in 'sending', which the claim query never selects again.
    // Without this sweep the claim trades a loud double-text for a silent lost
    // reminder — strictly worse, because nothing reports it.
    const id = await seedReminder('sending', 60); // claimed an hour ago, never finished

    const released = await releaseStaleClaims(pool);

    expect(released).toBeGreaterThanOrEqual(1);
    expect(await statusOf(id)).toBe('scheduled');
    // and it is claimable again
    const res = await pool.query(CLAIM_SQL, [100]);
    expect(res.rows.map((r) => Number(r.reminder_schedule_id))).toContain(id);
  });

  it('SAD: a claim that is merely IN PROGRESS is left alone', async () => {
    // The failure mode of an over-eager sweep is the exact double-text the claim
    // exists to prevent: release a row a live worker is still sending, and the
    // next tick sends it again. The window must be far wider than a real batch.
    const id = await seedReminder('sending', 0); // claimed just now

    await releaseStaleClaims(pool);

    // Asserted on THIS row's status, not on the returned count. The sweep is
    // deliberately tenant-agnostic — an abandoned claim is abandoned regardless
    // of whose reminder it is — so its return value counts rows this suite does
    // not own and cannot control. Asserting `released === 0` would be testing
    // the rest of the table, and would go red for a reason that has nothing to
    // do with the behaviour under test.
    expect(await statusOf(id)).toBe('sending');
  });
});

describe('processReminder accepts its own claimed rows', () => {
  it("HAPPY: a 'sending' row is processable, not silently skipped", async () => {
    // The second bug, which was hiding behind the first: processReminder gated
    // on `status !== 'scheduled'`, so the instant the claim started working every
    // claimed reminder would have been read, skipped, and stranded in 'sending'
    // with the worker counting it as processed.
    //
    // Asserted against the real service with a stub DB layer for the SEND side
    // only — the status gate is the thing under test, not Telnyx.
    const { ReminderService } = await import('../../src/services/reminders/index');

    const id = await seedReminder('sending', 0);
    const row = (
      await setup.query('SELECT * FROM reminder_schedules WHERE reminder_schedule_id = $1', [id])
    ).rows[0];

    const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
    const db = {
      getReminderSchedule: async () => row,
      getAppointmentById: async () => ({
        appointment_id: appointmentId,
        tenant_id: tenantId,
        dateTime: new Date(Date.now() + 86_400_000).toISOString(),
        status: 'scheduled',
        customer_phone: '+16305551212',
        customer_name: 'Claim Tester',
        service_name: 'Oil change',
        duration: 30,
      }),
      updateReminderSchedule: async (rid: string, patch: Record<string, unknown>) => {
        updates.push({ id: rid, patch });
      },
    };

    const service = new ReminderService(db, { getTenantConfig: async () => ({}) });
    // Consent + delivery are other suites' business; force both so the only
    // thing that can stop this reminder is the status gate.
    service.checkCommunicationConsent = async () => true;
    service.sendReminder = async () => true;

    await service.processReminder(String(id));

    expect(updates.map((u) => u.patch.status)).toContain('sent');
  });
});
