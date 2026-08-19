/**
 * Real-Postgres companion test for scheduleRemindersForAppointment — per
 * docs/TODO.md "Verification blind spots" (2026-07-01).
 *
 * The sibling scheduleForAppointment.test.ts mocks the pg client, so the
 * dynamically-built multi-row INSERT (valuesSql/params placeholder math into
 * reminder_schedules) never executes real SQL there. Historically this exact
 * class of code hid a UUID-vs-number FK type bug behind 24 green mocked tests
 * (CLAUDE.md "ID convention" origin story, 2026-05-11: ReminderSchedule.
 * appointment_id typed `number` against a UUID FK — every INSERT would have
 * crashed against real Postgres). This suite executes the real INSERT through
 * createWithTenantClient (api_user, RLS-scoped — same privileges as prod) and
 * asserts the reminder_schedules rows that actually land.
 *
 * Isolation: own tenant + own fixtures only, never TRUNCATE (other suites
 * share test_db concurrently). Cleanup = DELETE the tenant; both
 * reminder_schedules FKs (tenant_id, appointment_id) are ON DELETE CASCADE,
 * so one tenant delete sweeps appointments, customers, and reminder rows.
 * Skips honestly when the DB is down; hard-fails under REQUIRE_DB_TESTS=1.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { type Client, Pool } from 'pg';
import {
  API_DB_URL,
  getRootClient,
  createTenant,
  createResource,
  createCustomer,
  createCustomerFull,
  createAppointment,
  skipIfDbDown,
} from '../utils';
import { createWithTenantClient } from '../../src/database';
import type { WithTenantClient } from '../../src/services/reminders/scheduleForAppointment';
import {
  scheduleRemindersForAppointment,
  rescheduleRemindersForAppointment,
} from '../../src/services/reminders/scheduleForAppointment';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let setup: Client; // root client (postgres superuser) — fixtures + assertions
let pool: Pool; // api_user pool — what prod code runs on
let withTenantClient: WithTenantClient;
let dbAvailable = false;
let tenantId: string;
let resourceId: string;
/** Customer with BOTH email and phone — the fully-populated params path. */
let fullCustomerId: string;
/** Customer with phone but NO email — nulls must flow through the positional params. */
let phoneOnlyCustomerId: string;
const tenantsToClean: string[] = [];

const CUSTOMER_EMAIL = 'realdb-reminders@example.com';
const CUSTOMER_PHONE = '+15559990001';
const PHONE_ONLY_PHONE = '+15559990002';

/** Silent logger with a spy — lets sad paths assert "logged, not thrown". */
function spyLogger(): { logger: FastifyBaseLogger; errorSpy: ReturnType<typeof vi.fn> } {
  const errorSpy = vi.fn();
  return { logger: { error: errorSpy } as unknown as FastifyBaseLogger, errorSpy };
}

const QUARTER_MS = 15 * 60 * 1000;

/**
 * Future appointment start, far enough out that all 3 offset reminders are
 * future too. Snapped UP to a 15-minute boundary — the appointments table
 * enforces CHECK constraints (appointments_start/end_time_15min) matching
 * shared/appointmentValidation.ts's increment rule.
 */
function futureStart(daysAhead = 10): Date {
  const raw = Date.now() + daysAhead * DAY_MS;
  return new Date(Math.ceil(raw / QUARTER_MS) * QUARTER_MS);
}

async function reminderRows(appointmentId: string): Promise<
  Array<{
    appointment_id: string;
    tenant_id: string;
    customer_email: string | null;
    customer_phone: string | null;
    reminder_type: string;
    scheduled_for: Date;
    status: string;
  }>
> {
  const res = await setup.query(
    `SELECT appointment_id, tenant_id, customer_email, customer_phone,
            reminder_type, scheduled_for, status
       FROM reminder_schedules
      WHERE tenant_id = $1 AND appointment_id = $2
      ORDER BY reminder_type, status`,
    [tenantId, appointmentId]
  );
  return res.rows;
}

async function makeAppointment(customerId: string, start: Date): Promise<string> {
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return createAppointment(
    setup,
    tenantId,
    resourceId,
    customerId,
    start.toISOString(),
    end.toISOString(),
    'realdb reminder test appointment'
  );
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });
    withTenantClient = createWithTenantClient(pool);

    tenantId = await createTenant(setup, 'Blindspot Reminder Salon', 'salon');
    tenantsToClean.push(tenantId);
    resourceId = await createResource(setup, tenantId, 'Reminder Chair');
    fullCustomerId = await createCustomerFull(
      setup,
      tenantId,
      CUSTOMER_PHONE,
      'Reminder Rita',
      CUSTOMER_EMAIL
    );
    phoneOnlyCustomerId = await createCustomer(setup, tenantId, 'Phoneonly Pete', PHONE_ONLY_PHONE);

    dbAvailable = true;
  } catch (err) {
     
    console.warn('[scheduleForAppointment.realdb.test] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (pool) await pool.end();
  if (setup) {
    // Tenant delete cascades to appointments, customers, and (via both
    // ON DELETE CASCADE FKs) reminder_schedules — no explicit reminder
    // delete needed; verified against \d reminder_schedules.
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach((ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
});

describe('scheduleRemindersForAppointment → real multi-row INSERT into reminder_schedules', () => {
  it('HAPPY: seeds exactly 4 rows with the UUID appointment_id, copied contacts, and correct send offsets', async () => {
    // WHO: the booking route (agentTools scheduleRemindersForAppointment call)
    //      right after a caller books.
    // WHAT: one dynamically-built 4-row INSERT (confirmation/72h/24h/2h).
    // WHEN: immediately post-booking, appointment 10 days out.
    // WHERE: scheduleForAppointment.ts placeholder math ($1..$24) →
    //        reminder_schedules via api_user under RLS.
    // WHY: the mocked sibling test can't catch placeholder-math drift, a
    //      column-order mismatch, or the UUID-vs-number FK class of bug —
    //      only real Postgres rejects those.
    const start = futureStart(10);
    const before = new Date();
    const appointmentId = await makeAppointment(fullCustomerId, start);

    await scheduleRemindersForAppointment(withTenantClient, tenantId, appointmentId);
    const after = new Date();

    const rows = await reminderRows(appointmentId);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.reminder_type).sort()).toEqual(['24h', '2h', '72h', 'confirmation']);

    for (const row of rows) {
      // The FK landed as the appointment's UUID (string), not a coerced number.
      expect(row.appointment_id).toBe(appointmentId);
      expect(row.tenant_id).toBe(tenantId);
      expect(row.customer_email).toBe(CUSTOMER_EMAIL);
      expect(row.customer_phone).toBe(CUSTOMER_PHONE);
      expect(row.status).toBe('scheduled');
    }

    const byType = new Map(rows.map((r) => [r.reminder_type, r]));
    // Offset reminders: exactly N hours before the stored start_time.
    expect(byType.get('72h')!.scheduled_for.getTime()).toBe(start.getTime() - 72 * HOUR_MS);
    expect(byType.get('24h')!.scheduled_for.getTime()).toBe(start.getTime() - 24 * HOUR_MS);
    expect(byType.get('2h')!.scheduled_for.getTime()).toBe(start.getTime() - 2 * HOUR_MS);
    // Confirmation: "now" at call time — bounded by the timestamps we took
    // around the call (second-level tolerance for clock granularity).
    const confirmation = byType.get('confirmation')!.scheduled_for.getTime();
    expect(confirmation).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(confirmation).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it('HAPPY (null-params variant): a customer with no email still gets 4 rows, email NULL, phone copied', async () => {
    // WHO: a walk-in caller the desk saved with phone only.
    // WHAT: the same 4-row INSERT, but with NULLs interleaved in the flat
    //       params array (customer_email = null at positions 3, 9, 15, 21).
    // WHY: a positional-placeholder off-by-one would smear the NULL into a
    //      neighboring column (e.g. reminder_type) — only a real INSERT with
    //      real CHECK constraints catches that. There is no true single-row
    //      path in this function (the bundle is fixed at 4), so this is the
    //      minimal-params variant instead.
    const appointmentId = await makeAppointment(phoneOnlyCustomerId, futureStart(9));

    await scheduleRemindersForAppointment(withTenantClient, tenantId, appointmentId);

    const rows = await reminderRows(appointmentId);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.customer_email).toBeNull();
      expect(row.customer_phone).toBe(PHONE_ONLY_PHONE);
      expect(row.status).toBe('scheduled');
    }
  });

  it('IDEMPOTENT: calling twice for the same appointment seeds exactly ONE bundle (4 rows)', async () => {
    // WHO: any caller that invokes the fire-and-forget seed twice (e.g. a
    //      retried booking handler, or a double tool-call from the agent).
    // WHAT: two sequential scheduleRemindersForAppointment calls.
    // WHY: fixed 2026-07-01 — idempotency is enforced by the partial unique
    //      index reminder_schedules_one_scheduled_per_type (migration
    //      20260701020000) + ON CONFLICT DO NOTHING, so a retry can never
    //      double-remind the customer. (Before the fix this seeded 8 rows.)
    //      Reschedule still reseeds because rescheduleRemindersForAppointment
    //      cancels the old bundle first — covered by the reschedule test.
    const appointmentId = await makeAppointment(fullCustomerId, futureStart(8));

    await scheduleRemindersForAppointment(withTenantClient, tenantId, appointmentId);
    await scheduleRemindersForAppointment(withTenantClient, tenantId, appointmentId);

    const rows = await reminderRows(appointmentId);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.status === 'scheduled')).toBe(true);
  });

  it('IDEMPOTENT under CONCURRENCY: parallel seeds still produce exactly one bundle (unique index arbiter)', async () => {
    // WHO: two overlapping fire-and-forget seeds for the same booking (retry
    //      wrapper racing the original, or a double tool-call).
    // WHAT: 4 scheduleRemindersForAppointment calls launched in PARALLEL on
    //       separate pool connections.
    // WHY: an app-level probe is check-then-insert (TOCTOU) — racers could
    //      both see zero rows and both insert (Copilot review, PR #156).
    //      Idempotency therefore lives in the DB: the partial unique index
    //      (one 'scheduled' row per appointment+type) + ON CONFLICT DO
    //      NOTHING resolves the race in the arbiter, with no cross-statement
    //      locks (an advisory-lock transaction deadlocked the appointments
    //      cascade in E2E). 8 rows here = the index or conflict clause
    //      regressed.
    const appointmentId = await makeAppointment(fullCustomerId, futureStart(11));

    await Promise.all(
      Array.from({ length: 4 }, () =>
        scheduleRemindersForAppointment(withTenantClient, tenantId, appointmentId)
      )
    );

    const rows = await reminderRows(appointmentId);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.status === 'scheduled')).toBe(true);
  });

  it('SAD: nonexistent appointment id → zero rows, resolves without throwing', async () => {
    // WHO: the booking route racing an immediate cancellation (appointment
    //      row vanished between RPC and reminder seed).
    // WHAT: schedule against a random UUID that matches no appointment.
    // WHY: fire-and-forget contract — a reminder failure must never fail the
    //      booking; the function returns silently and writes nothing.
    const ghostId = '00000000-0000-4000-8000-00000000dead';
    const { logger, errorSpy } = spyLogger();

    await expect(
      scheduleRemindersForAppointment(withTenantClient, tenantId, ghostId, logger)
    ).resolves.toBeUndefined();

    const rows = await reminderRows(ghostId);
    expect(rows).toHaveLength(0);
    // Missing row is the documented silent-skip, not an error.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('SAD: appointment start_time in the past → zero rows, no throw (walk-in carve-out)', async () => {
    // WHO: an operator recording a walk-in that already happened.
    // WHAT: appointment whose start_time is 2 hours ago.
    // WHY: reminders for a past appointment are nonsensical; the documented
    //      carve-out skips silently instead of seeding rows the worker would
    //      immediately fire at a confused customer.
    // Snapped DOWN so it stays in the past AND satisfies the 15-min CHECK.
    const pastStart = new Date(Math.floor((Date.now() - 2 * HOUR_MS) / QUARTER_MS) * QUARTER_MS);
    const appointmentId = await makeAppointment(fullCustomerId, pastStart);
    const { logger, errorSpy } = spyLogger();

    await expect(
      scheduleRemindersForAppointment(withTenantClient, tenantId, appointmentId, logger)
    ).resolves.toBeUndefined();

    expect(await reminderRows(appointmentId)).toHaveLength(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('SAD: nonexistent tenant → error is swallowed into the logger, nothing thrown, nothing written', async () => {
    // WHO: a caller passing a tenant id that was deleted mid-flight.
    // WHAT: withTenantClient's TENANT_NOT_FOUND throw, absorbed by the
    //       function's try/catch.
    // WHERE: createWithTenantClient tenant-existence check → catch block →
    //        logger.error('Failed to schedule reminders for appointment').
    // WHY: the fire-and-forget contract holds even for infrastructure-level
    //      failures — log it (so errors_total-style diagnosis works), never
    //      bubble it into the booking response.
    const ghostTenant = '00000000-0000-4000-8000-0000000feed5';
    const { logger, errorSpy } = spyLogger();

    await expect(
      scheduleRemindersForAppointment(withTenantClient, ghostTenant, ghostTenant, logger)
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const res = await setup.query(`SELECT 1 FROM reminder_schedules WHERE tenant_id = $1`, [
      ghostTenant,
    ]);
    expect(res.rows).toHaveLength(0);
  });
});

describe('rescheduleRemindersForAppointment → cancel-then-seed against real rows', () => {
  it('HAPPY: cancels the old bundle and seeds 4 fresh rows offset from the NEW start_time', async () => {
    // WHO: the operator moving an appointment via /appointments/:id/update.
    // WHAT: UPDATE status='cancelled' on the old 4, then a fresh 4-row INSERT.
    // WHEN: after the appointment's start_time moved 2 days later.
    // WHERE: rescheduleRemindersForAppointment → scheduleRemindersForAppointment.
    // WHY: without the cancel, the customer gets reminders for the OLD time;
    //      this asserts the audit-preserving cancelled rows AND that the new
    //      scheduled rows are computed from the new start.
    // Day 20 (moving to day 22) — clear of every other test's appointment;
    // all suite appointments share one resource and the GiST exclusion
    // constraint (appointments_no_resource_overlap) forbids overlaps.
    const originalStart = futureStart(20);
    const appointmentId = await makeAppointment(fullCustomerId, originalStart);
    await scheduleRemindersForAppointment(withTenantClient, tenantId, appointmentId);
    expect(await reminderRows(appointmentId)).toHaveLength(4);

    const newStart = new Date(originalStart.getTime() + 2 * DAY_MS);
    const newEnd = new Date(newStart.getTime() + 30 * 60 * 1000);
    await setup.query(
      `UPDATE appointments SET start_time = $1, end_time = $2 WHERE appointment_id = $3`,
      [newStart.toISOString(), newEnd.toISOString(), appointmentId]
    );

    await rescheduleRemindersForAppointment(withTenantClient, tenantId, appointmentId);

    const rows = await reminderRows(appointmentId);
    expect(rows).toHaveLength(8);
    const cancelled = rows.filter((r) => r.status === 'cancelled');
    const scheduled = rows.filter((r) => r.status === 'scheduled');
    expect(cancelled).toHaveLength(4);
    expect(scheduled).toHaveLength(4);

    // Old rows preserved (audit trail) at the ORIGINAL offsets…
    const cancelled24 = cancelled.find((r) => r.reminder_type === '24h')!;
    expect(cancelled24.scheduled_for.getTime()).toBe(originalStart.getTime() - 24 * HOUR_MS);
    // …new rows computed from the NEW start.
    const scheduled24 = scheduled.find((r) => r.reminder_type === '24h')!;
    expect(scheduled24.scheduled_for.getTime()).toBe(newStart.getTime() - 24 * HOUR_MS);
    const scheduled72 = scheduled.find((r) => r.reminder_type === '72h')!;
    expect(scheduled72.scheduled_for.getTime()).toBe(newStart.getTime() - 72 * HOUR_MS);
  });
});
