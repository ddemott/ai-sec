/**
 * E2E coverage for the reminder-on-create wire shipped 2026-05-11 (TODO
 * P2: "Reminder scheduled on appointment create. reminder_schedules row
 * appears with the right scheduled_for; worker delivers it (or, in dev,
 * no-ops without crashing)").
 *
 * What this spec pins:
 *
 *   1. HAPPY: POST /appointments/create on a future slot writes exactly 4
 *      reminder_schedules rows (confirmation + 72h/24h/2h-before), each
 *      with the right reminder_type, scheduled_for offset relative to the
 *      booking's start_time, and propagated customer email + phone.
 *
 *   2. HAPPY: A customer with email AND phone populates both contact
 *      columns. A phone-only customer (the default for /customers/create)
 *      populates phone and leaves email NULL. The 4-row contract is
 *      identical regardless — the worker decides at send time which
 *      channels to actually use.
 *
 * Why API-only (no UI driving): the contract under test is the BACKEND
 * fire-and-forget wire between appointment-create and the reminder
 * scheduler. Driving the dashboard adds SSR/hydration variance for no
 * extra coverage; the unit tests in `src/routes/appointments.test.ts`
 * and `src/services/reminders/scheduleForAppointment.test.ts` already
 * pin the route-level mock-call contract and the helper logic.
 *
 * Why not also exercising the worker: the ticket's "worker delivers it
 * (or, in dev, no-ops without crashing)" parenthetical reflects that the
 * worker has its own consent gate + provider fallback story. The wire
 * has to put the right rows in place; whether they deliver is a separate
 * concern owned by src/workers/reminderScheduler.ts. The schema
 * compatibility (UUID-typed appointment_id + tenant_id matching the
 * appointments + tenants FK targets) is what was broken pre-2026-05-11.
 *
 * Each test owns its data lifecycle: registerFreshTenant → seed booking
 * scenario → POST /appointments/create → SELECT reminder_schedules →
 * DELETE FROM tenants in `finally` (cascades to reminder_schedules via
 * the appointment FK).
 */
import { test, expect } from './helpers/test';
import { Pool } from 'pg';
import {
  BACKEND_URL,
  PG_URL,
  bookAppointmentAs,
  cleanTenantData,
  isoDateDaysFromNow,
  registerFreshTenant,
  seedBookingScenario,
  type RegisteredTenant,
} from './helpers/fixtures';

let pool: Pool;

interface ReminderRow {
  reminder_type: 'confirmation' | '72h' | '24h' | '2h';
  scheduled_for: Date;
  customer_email: string | null;
  customer_phone: string | null;
  status: string;
  appointment_id: string;
  tenant_id: string;
}

async function getRemindersForAppointment(
  appointmentId: string,
  tenantId: string
): Promise<ReminderRow[]> {
  const { rows } = await pool.query<ReminderRow>(
    `SELECT reminder_type, scheduled_for, customer_email, customer_phone, status, appointment_id, tenant_id
       FROM reminder_schedules
      WHERE appointment_id = $1 AND tenant_id = $2`,
    [appointmentId, tenantId]
  );
  return rows;
}

async function patchCustomerEmail(
  tenantId: string,
  customerId: string,
  email: string
): Promise<void> {
  await pool.query(`UPDATE customers SET email = $1 WHERE customer_id = $2 AND tenant_id = $3`, [
    email,
    customerId,
    tenantId,
  ]);
}

async function waitForReminders(
  appointmentId: string,
  tenantId: string,
  expectedCount: number,
  timeoutMs = 4000
): Promise<ReminderRow[]> {
  // The reminder-schedule call inside POST /appointments/create is
  // fire-and-forget — by the time the HTTP response returns, the INSERTs
  // may still be in flight. Poll for up to ~4s, which dwarfs any reasonable
  // local DB latency on the 4 inserts.
  const start = Date.now();
  let last: ReminderRow[] = [];
  while (Date.now() - start < timeoutMs) {
    last = await getRemindersForAppointment(appointmentId, tenantId);
    if (last.length === expectedCount) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  return last;
}

test.beforeAll(() => {
  pool = new Pool({ connectionString: PG_URL });
  // Smoke-check that BACKEND_URL is set — failures here surface a missing
  // local backend up front instead of as opaque connection refused later.
  expect(BACKEND_URL).toBeTruthy();
});
test.afterAll(async () => {
  await pool.end();
});

// ────────────────────────────────────────────────────────────────────────────
// 1. HAPPY: 4 rows with correct scheduled_for offsets + phone-only customer
// ────────────────────────────────────────────────────────────────────────────
test('reminder-on-create-happy: future appointment produces 4 reminder rows with correct scheduled_for offsets', async ({
  request,
}) => {
  // WHO: front-desk operator booking a customer 7 days out via the dashboard.
  // WHAT: POST /appointments/create returns 200 with appointment_id; within
  //        a few hundred ms, reminder_schedules contains 4 rows for that
  //        appointment — one per reminder_type (confirmation, 72h, 24h, 2h).
  //        confirmation.scheduled_for ≈ now; the other three are offset
  //        backwards from start_time by their hour count.
  // WHEN: the wire shipped 2026-05-11 closes the TODO P2 "Reminder scheduled
  //        on appointment create" — before that, no production caller invoked
  //        the reminder scheduler, so no rows ever appeared even though the
  //        worker was polling.
  // WHERE: src/routes/appointments.ts POST /appointments/create after the
  //        booking RPC succeeds → src/services/reminders/scheduleForAppointment
  //        .ts scheduleRemindersForAppointment.
  // WHY: if a future refactor drops the wire or the helper writes the wrong
  //        number / kind of rows, this test catches it within a second.
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const date = isoDateDaysFromNow(7);
    const seed = await seedBookingScenario(request, pool, tenant.token, tenant.tenantId, {
      employees: ['Test Tech'],
      resources: ['Test Bay'],
      shiftDates: [date],
    });

    const startTime = `${date}T14:00:00.000Z`;
    const endTime = `${date}T14:30:00.000Z`;
    const t0 = Date.now();
    const bookRes = await bookAppointmentAs(request, tenant.token, {
      tenant_id: tenant.tenantId,
      resource_id: seed.resourceIds[0],
      customer_id: seed.customerId,
      employee_id: seed.employeeIds[0],
      start_time: startTime,
      end_time: endTime,
      description: 'oil change — pinning reminder rows',
    });
    expect(bookRes.status, `book must succeed; body=${JSON.stringify(bookRes.body)}`).toBe(200);
    const appointmentId = bookRes.body.appointment_id as string;
    expect(appointmentId).toBeTruthy();

    const reminders = await waitForReminders(appointmentId, tenant.tenantId, 4);
    expect(reminders, 'must have 4 reminder rows (confirmation + 72h/24h/2h)').toHaveLength(4);

    const byType = new Map<string, ReminderRow>();
    for (const r of reminders) byType.set(r.reminder_type, r);
    expect([...byType.keys()].sort()).toEqual(['24h', '2h', '72h', 'confirmation']);

    // confirmation.scheduled_for is "now" at the moment the helper ran —
    // somewhere between t0 and just after the response landed. Allow a
    // wide ±30s envelope so a slow CI machine doesn't flake.
    const confirmationTs = byType.get('confirmation')!.scheduled_for.getTime();
    expect(confirmationTs).toBeGreaterThanOrEqual(t0 - 30_000);
    expect(confirmationTs).toBeLessThanOrEqual(Date.now() + 30_000);

    // 72h / 24h / 2h offsets are exact arithmetic on start_time — pin them.
    const startMs = new Date(startTime).getTime();
    expect(byType.get('72h')!.scheduled_for.getTime()).toBe(startMs - 72 * 60 * 60 * 1000);
    expect(byType.get('24h')!.scheduled_for.getTime()).toBe(startMs - 24 * 60 * 60 * 1000);
    expect(byType.get('2h')!.scheduled_for.getTime()).toBe(startMs - 2 * 60 * 60 * 1000);

    // Every row carries the tenant + appointment + customer contact propagation.
    for (const r of reminders) {
      expect(r.tenant_id).toBe(tenant.tenantId);
      expect(r.appointment_id).toBe(appointmentId);
      expect(r.status).toBe('scheduled');
      expect(r.customer_phone, 'phone is NOT NULL on customers; must propagate').toMatch(/^\+/);
      // Phone-only customer (createCustomerAs doesn't pass email); column is nullable.
      expect(r.customer_email).toBeNull();
    }
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 2. HAPPY: customer with both email and phone — both columns populate
// ────────────────────────────────────────────────────────────────────────────
test('reminder-on-create-contact-propagation: customer with both email and phone populates both columns on every row', async ({
  request,
}) => {
  // WHO: a customer who provided both email AND phone (the most-common
  //       beta-customer shape, not the call-in walk-in shape).
  // WHAT: 4 reminder rows still produced; each row's customer_email AND
  //        customer_phone columns populated from the customer record.
  // WHEN: customers.email is set (either at create or via subsequent update).
  // WHERE: scheduleForAppointment.ts joins appointments → customers and
  //        reads both columns into the INSERT.
  // WHY: a regression that drops the customer JOIN or only reads one of
  //        the two contact columns would leave the worker unable to deliver
  //        on the missing channel (so e.g. only SMS would go out even
  //        though the customer asked for email reminders).
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const date = isoDateDaysFromNow(7);
    const seed = await seedBookingScenario(request, pool, tenant.token, tenant.tenantId, {
      employees: ['Test Tech'],
      resources: ['Test Bay'],
      shiftDates: [date],
    });

    const expectedEmail = `e2e-${Date.now()}@example.com`;
    await patchCustomerEmail(tenant.tenantId, seed.customerId, expectedEmail);

    const bookRes = await bookAppointmentAs(request, tenant.token, {
      tenant_id: tenant.tenantId,
      resource_id: seed.resourceIds[0],
      customer_id: seed.customerId,
      employee_id: seed.employeeIds[0],
      start_time: `${date}T15:00:00.000Z`,
      end_time: `${date}T15:30:00.000Z`,
      description: 'pinning both-channel contact propagation',
    });
    expect(bookRes.status).toBe(200);
    const appointmentId = bookRes.body.appointment_id as string;

    const reminders = await waitForReminders(appointmentId, tenant.tenantId, 4);
    expect(reminders).toHaveLength(4);
    for (const r of reminders) {
      expect(r.customer_email).toBe(expectedEmail);
      expect(r.customer_phone).toMatch(/^\+/);
    }
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});
