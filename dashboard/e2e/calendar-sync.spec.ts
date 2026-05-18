/**
 * E2E coverage for the calendar + CRM sync orchestration layer.
 *
 * Why this exists: TEST_COVERAGE.md flagged "Calendar sync (Google +
 * Outlook OAuth)" + the four CRM bidirectional flows as having zero
 * e2e coverage. The unit tests in src/calendar-sync.test.ts and the
 * four src/<crm>-sync.test.ts files mock the provider modules and
 * prove the conversion logic; what was missing is "do the routes
 * actually invoke the orchestrator on every appointment and customer
 * lifecycle event."
 *
 * What's covered:
 *   - POST /appointments/create → 5 sync dispatches (calendar + 4 CRMs)
 *   - POST /appointments/:id/update → 5 dispatches with action='update'
 *   - DELETE /appointments/:id → 5 dispatches with action='delete'
 *   - POST /customers/create → 4 CRM dispatches (calendars don't get
 *     customer events — that's part of the contract)
 *   - PUT  /customers/:id  → 4 dispatches with action='update'
 *   - DELETE /customers/:id → 4 dispatches with action='delete'
 *   - Fire-and-forget: HTTP response returns within ~3s even with all
 *     5 provider promises in flight
 *
 * What's NOT covered:
 *   - Whether each provider's actual outbound HTTP request is well-formed
 *     (that's at the unit level — src/calendar-sync.test.ts et al.).
 *   - OAuth refresh + token rotation (token-management.test.ts).
 *
 * Mechanism: the orchestrator records every dispatch into an in-memory
 * buffer when SYNC_TEST_RECORDER=1 is set on the backend at boot. The
 * /agent-tools/_test/sync-events route exposes that buffer for
 * assertion. If the recorder isn't enabled, every test in this file
 * skips with a clear message — so a forgotten env var doesn't silently
 * pass tests that assert nothing.
 *
 * API-only design: this spec uses Playwright's APIRequestContext (no
 * page navigation) so it's not affected by dashboard SSR/hydration
 * flakes that block the page-based specs. Each test creates its own
 * employee_schedule + customer + appointment fixtures and cleans them
 * up in `finally`, per the test-isolation feedback memory.
 */
import { test, expect } from './helpers/test';
import { type APIRequestContext } from '@playwright/test';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { seedDynaTireBusinessConfig, clearDynaTireBusinessConfig } from './helpers/fixtures';

const DYNATIRE_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const PG_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/postgres';
// Log in as the DynaTire tenant admin so the JWT carries
// tenant_id=DYNATIRE_ID. Several routes (DELETE /appointments/:id, PUT
// /customers/:id) read tenant_id from JWT context only — they don't
// have a super-admin override path. Logging in as the platform admin
// (admin@secretaryhq.com) would yield a JWT with the super-admin tenant
// and the WHERE id = $1 AND tenant_id = $2 lookup would 404 against
// rows in the DynaTire tenant.
const TENANT_ADMIN_EMAIL = 'admin@dynatire.com';
const TENANT_ADMIN_PASSWORD = 'password';
const FUTURE_DATE = '2026-06-22';
const BACKEND_URL = 'https://localhost:4001';

function readAgentSecret(): string {
  if (process.env.AGENT_SECRET) return process.env.AGENT_SECRET;
  try {
    const envPath = join(__dirname, '..', '..', '.env');
    const content = readFileSync(envPath, 'utf8');
    const match = content.match(/^AGENT_SECRET=(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    // fall through
  }
  throw new Error('AGENT_SECRET not found — needed to read /agent-tools/_test/sync-events');
}
const AGENT_SECRET = readAgentSecret();

let pool: Pool;

function uniqueTag(): string {
  return `e2e-sync-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function uniquePhone(): string {
  return `+1555${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`;
}

type SyncEvent = {
  ts: string;
  provider: string;
  entity: 'appointment' | 'customer';
  action: 'create' | 'update' | 'delete';
  tenantId: string;
  entityId: string;
};

async function getSyncEvents(req: APIRequestContext): Promise<SyncEvent[]> {
  const res = await req.get(`${BACKEND_URL}/agent-tools/_test/sync-events`, {
    headers: { 'x-agent-secret': AGENT_SECRET },
  });
  if (res.status() === 404) throw new Error('SYNC_TEST_RECORDER not enabled');
  const body = await res.json();
  return (body.result?.events ?? []) as SyncEvent[];
}

async function clearSyncEvents(req: APIRequestContext): Promise<void> {
  const res = await req.delete(`${BACKEND_URL}/agent-tools/_test/sync-events`, {
    // No Content-Type: application/json on a body-less DELETE — Fastify's
    // parser otherwise rejects it as Invalid JSON and we can't tell
    // "recorder disabled" from "request never reached the route".
    headers: { 'x-agent-secret': AGENT_SECRET },
  });
  if (res.status() === 404) throw new Error('SYNC_TEST_RECORDER not enabled');
}

async function recorderAvailable(req: APIRequestContext): Promise<boolean> {
  try {
    const res = await req.get(`${BACKEND_URL}/agent-tools/_test/sync-events`, {
      headers: { 'x-agent-secret': AGENT_SECRET },
    });
    return res.status() === 200;
  } catch {
    return false;
  }
}

async function loginAsTenantAdmin(req: APIRequestContext): Promise<string> {
  const res = await req.post(`${BACKEND_URL}/login`, {
    data: { email: TENANT_ADMIN_EMAIL, password: TENANT_ADMIN_PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await res.json();
  if (!body?.token) throw new Error(`Login failed: ${JSON.stringify(body)}`);
  return body.token as string;
}

async function findEmployeeIdByName(name: string): Promise<string> {
  const r = await pool.query(
    'SELECT employee_id FROM employees WHERE tenant_id = $1 AND name = $2 LIMIT 1',
    [DYNATIRE_ID, name]
  );
  if (!r.rows[0]) throw new Error(`Employee "${name}" not found in DynaTire seed`);
  return r.rows[0].employee_id;
}

async function findResourceIdByName(name: string): Promise<string> {
  const r = await pool.query(
    'SELECT resource_id FROM resources WHERE tenant_id = $1 AND name = $2 LIMIT 1',
    [DYNATIRE_ID, name]
  );
  if (!r.rows[0]) throw new Error(`Resource "${name}" not found in DynaTire seed`);
  return r.rows[0].resource_id;
}

test.beforeAll(async () => {
  pool = new Pool({ connectionString: PG_URL });
  // 2026-05-18 seed-strip-stage-b: DynaTire's business config moved
  // out of supabase/seed.sql. Bootstrap it so the find* helpers and
  // every booking-side-effect test in this spec has rows to act on.
  await seedDynaTireBusinessConfig(pool);
});
test.afterAll(async () => {
  await clearDynaTireBusinessConfig(pool);
  await pool.end();
});

test.beforeEach(async ({ request }, testInfo) => {
  const ok = await recorderAvailable(request);
  if (!ok) {
    testInfo.skip(
      true,
      'SYNC_TEST_RECORDER=1 must be set on the backend before npm start. ' +
        'Run: `SYNC_TEST_RECORDER=1 npm start` then re-run this spec.'
    );
    return;
  }
  // Clear the recorder so each test asserts on a fresh window. Without
  // this the buffer cross-contaminates and a 5-event assertion lands
  // on a 10-event buffer.
  await clearSyncEvents(request);
});

// ────────────────────────────────────────────────────────────────────────────
// Appointment lifecycle dispatch
// ────────────────────────────────────────────────────────────────────────────

test('appointment-create dispatches all 5 sync providers (calendar + 4 CRMs)', async ({ request }) => {
  // WHO: front-desk creates a normal appointment via the API
  // WHAT: /appointments/create returns 200 + the orchestrator records 5
  //        sync dispatches with action='create' and matching appointmentId
  // WHEN: every successful appointment-create lifecycle event
  // WHERE: src/routes/appointments.ts line 148 calls syncAppointmentToAll
  // WHY: this is the load-bearing promise of the integration story —
  //        when an operator books an appointment, downstream calendars
  //        + CRMs find out. If any future refactor accidentally skips
  //        the dispatch (or only fires it for some routes), the
  //        customer's Google Calendar silently goes stale and they
  //        double-book themselves with another vendor.
  const tag = uniqueTag();
  const apptIdsToCleanup: string[] = [];
  let scheduleSeeded = false;
  let customerId: string | null = null;

  // Hoisted out of `try` (pilot #3, 2026-05-18) so the `finally` cleanup
  // can pass mikeId into the composite-key DELETE.
  let mikeId: string | null = null;

  try {
    mikeId = await findEmployeeIdByName('Mike Rivera');
    const truckId = await findResourceIdByName('Truck 1');

    const cIns = await pool.query(
      `INSERT INTO customers (tenant_id, name, phone) VALUES ($1, $2, $3) RETURNING customer_id`,
      [DYNATIRE_ID, `${tag}-cust`, uniquePhone()]
    );
    customerId = cIns.rows[0].customer_id;

    await pool.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1, $2, $3, '09:00', '17:00', false)
       ON CONFLICT (tenant_id, employee_id, shift_date) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
      [DYNATIRE_ID, mikeId, FUTURE_DATE]
    );
    scheduleSeeded = true;

    const token = await loginAsTenantAdmin(request);
    await clearSyncEvents(request); // login won't dispatch sync but be defensive

    const res = await request.post(`${BACKEND_URL}/appointments/create`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      data: {
        tenant_id: DYNATIRE_ID,
        resource_id: truckId,
        customer_id: customerId,
        employee_id: mikeId,
        start_time: `${FUTURE_DATE}T14:00:00.000Z`,
        end_time: `${FUTURE_DATE}T14:30:00.000Z`,
        description: tag,
      },
    });
    const body = await res.json();

    expect(res.status(), 'happy-path appointment-create must succeed').toBe(200);
    expect(body.success).toBe(true);
    const appointmentId = body.appointment_id as string;
    expect(appointmentId, 'route must return appointment_id').toBeTruthy();
    apptIdsToCleanup.push(appointmentId);

    // Fire-and-forget: events may not all land before the route returns.
    // 500ms is plenty for in-process synchronous record() calls.
    await new Promise((r) => setTimeout(r, 500));
    const events = await getSyncEvents(request);
    const matching = events.filter(
      (e) => e.entity === 'appointment' && e.action === 'create' && e.entityId === appointmentId
    );
    expect(matching).toHaveLength(5);
    expect(matching.map((e) => e.provider).sort()).toEqual(
      ['calendar', 'hubspot', 'jobber', 'servicetitan', 'square']
    );
    for (const e of matching) {
      expect(e.tenantId).toBe(DYNATIRE_ID);
    }
  } finally {
    for (const id of apptIdsToCleanup) await pool.query('DELETE FROM appointments WHERE appointment_id = $1', [id]);
    if (scheduleSeeded && mikeId) await pool.query('DELETE FROM employee_schedule WHERE tenant_id = $1 AND employee_id = $2 AND shift_date = $3', [DYNATIRE_ID, mikeId, FUTURE_DATE]);
    if (customerId) await pool.query('DELETE FROM customers WHERE customer_id = $1', [customerId]);
  }
});

test('appointment-update dispatches all 5 providers with action=update', async ({ request }) => {
  // WHO: operator drags an appointment to a new time on the scheduler
  // WHAT: POST /appointments/:id/update fires 5 'update' dispatches
  // WHY: route appointments.ts:369 must call syncAppointmentToAll on
  //        successful updates. If skipped, the external calendar shows
  //        the OLD time and the customer arrives at the wrong slot.
  const tag = uniqueTag();
  let apptId: string | null = null;
  let scheduleSeeded = false;
  let customerId: string | null = null;

  // Hoisted out of `try` (pilot #3, 2026-05-18) so the `finally` cleanup
  // can pass mikeId into the composite-key DELETE.
  let mikeId: string | null = null;

  try {
    mikeId = await findEmployeeIdByName('Mike Rivera');
    const truckId = await findResourceIdByName('Truck 1');
    const cIns = await pool.query(
      `INSERT INTO customers (tenant_id, name, phone) VALUES ($1, $2, $3) RETURNING customer_id`,
      [DYNATIRE_ID, `${tag}-cust`, uniquePhone()]
    );
    customerId = cIns.rows[0].customer_id;

    await pool.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1, $2, $3, '09:00', '17:00', false)
       ON CONFLICT (tenant_id, employee_id, shift_date) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
      [DYNATIRE_ID, mikeId, FUTURE_DATE]
    );
    scheduleSeeded = true;

    // Pre-insert directly so creation doesn't dispatch 5 sync events
    // and pollute the assertion below.
    const aIns = await pool.query(
      `INSERT INTO appointments (tenant_id, resource_id, customer_id, employee_id, start_time, end_time, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled') RETURNING appointment_id`,
      [
        DYNATIRE_ID,
        truckId,
        customerId,
        mikeId,
        `${FUTURE_DATE}T15:00:00.000Z`,
        `${FUTURE_DATE}T15:30:00.000Z`,
        tag,
      ]
    );
    apptId = aIns.rows[0].appointment_id;

    const token = await loginAsTenantAdmin(request);
    await clearSyncEvents(request);

    const res = await request.post(`${BACKEND_URL}/appointments/${apptId}/update`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      data: {
        tenant_id: DYNATIRE_ID,
        start_time: `${FUTURE_DATE}T16:00:00.000Z`,
        end_time: `${FUTURE_DATE}T16:30:00.000Z`,
      },
    });
    const body = await res.json();

    expect(res.status(), 'update must succeed').toBe(200);
    expect(body.success).toBe(true);

    await new Promise((r) => setTimeout(r, 500));
    const events = await getSyncEvents(request);
    const matching = events.filter(
      (e) => e.entity === 'appointment' && e.action === 'update' && e.entityId === apptId
    );
    expect(matching).toHaveLength(5);
    expect(matching.map((e) => e.provider).sort()).toEqual(
      ['calendar', 'hubspot', 'jobber', 'servicetitan', 'square']
    );
  } finally {
    if (apptId) await pool.query('DELETE FROM appointments WHERE appointment_id = $1', [apptId]);
    if (scheduleSeeded && mikeId) await pool.query('DELETE FROM employee_schedule WHERE tenant_id = $1 AND employee_id = $2 AND shift_date = $3', [DYNATIRE_ID, mikeId, FUTURE_DATE]);
    if (customerId) await pool.query('DELETE FROM customers WHERE customer_id = $1', [customerId]);
  }
});

test('appointment-delete dispatches all 5 providers with action=delete', async ({ request }) => {
  // WHO: customer cancels and operator hard-deletes the appointment
  // WHAT: DELETE /appointments/:id fires 5 'delete' dispatches so the
  //        external calendar event is removed and CRMs flip their
  //        status mirror to "cancelled"
  // WHY: a stale "scheduled" event in Google Calendar after a cancel
  //        leads to no-shows showing up at a closed bay or worse
  let apptId: string | null = null;
  let scheduleSeeded = false;
  let customerId: string | null = null;
  const tag = uniqueTag();

  // Hoisted out of `try` (pilot #3, 2026-05-18) so the `finally` cleanup
  // can pass mikeId into the composite-key DELETE.
  let mikeId: string | null = null;

  try {
    mikeId = await findEmployeeIdByName('Mike Rivera');
    const truckId = await findResourceIdByName('Truck 1');
    const cIns = await pool.query(
      `INSERT INTO customers (tenant_id, name, phone) VALUES ($1, $2, $3) RETURNING customer_id`,
      [DYNATIRE_ID, `${tag}-cust`, uniquePhone()]
    );
    customerId = cIns.rows[0].customer_id;

    await pool.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1, $2, $3, '09:00', '17:00', false)
       ON CONFLICT (tenant_id, employee_id, shift_date) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
      [DYNATIRE_ID, mikeId, FUTURE_DATE]
    );
    scheduleSeeded = true;

    const aIns = await pool.query(
      `INSERT INTO appointments (tenant_id, resource_id, customer_id, employee_id, start_time, end_time, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled') RETURNING appointment_id`,
      [
        DYNATIRE_ID,
        truckId,
        customerId,
        mikeId,
        `${FUTURE_DATE}T13:00:00.000Z`,
        `${FUTURE_DATE}T13:30:00.000Z`,
        tag,
      ]
    );
    apptId = aIns.rows[0].appointment_id;

    const token = await loginAsTenantAdmin(request);
    await clearSyncEvents(request);

    // No body on DELETE — passing Content-Type: application/json with an
    // empty payload trips Fastify's JSON parser ("Invalid JSON" → 500).
    const res = await request.delete(`${BACKEND_URL}/appointments/${apptId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    expect(res.status(), 'delete must succeed').toBe(200);
    expect(body.success).toBe(true);

    await new Promise((r) => setTimeout(r, 500));
    const events = await getSyncEvents(request);
    const matching = events.filter(
      (e) => e.entity === 'appointment' && e.action === 'delete' && e.entityId === apptId
    );
    expect(matching).toHaveLength(5);
    expect(matching.map((e) => e.provider).sort()).toEqual(
      ['calendar', 'hubspot', 'jobber', 'servicetitan', 'square']
    );
    apptId = null; // already deleted
  } finally {
    if (apptId) await pool.query('DELETE FROM appointments WHERE appointment_id = $1', [apptId]);
    if (scheduleSeeded && mikeId) await pool.query('DELETE FROM employee_schedule WHERE tenant_id = $1 AND employee_id = $2 AND shift_date = $3', [DYNATIRE_ID, mikeId, FUTURE_DATE]);
    if (customerId) await pool.query('DELETE FROM customers WHERE customer_id = $1', [customerId]);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Customer lifecycle dispatch — only 4 providers, no calendar
// ────────────────────────────────────────────────────────────────────────────

test('customer-create dispatches to 4 CRMs (no calendar — by contract)', async ({ request }) => {
  // WHO: operator adds a new walk-in customer via the Customers tab
  // WHAT: /customers/create fires 4 'create' dispatches — Jobber +
  //        HubSpot + Square + ServiceTitan. Calendars are not in the
  //        customer dispatch list because they don't store contacts.
  // WHY: pin the customer-side contract. If a refactor accidentally
  //        adds calendar to syncCustomerToAll, this test fails (count
  //        becomes 5) — would mean we tried to push contacts to Google
  //        Calendar, which has no concept of contact records.
  const tag = uniqueTag();
  let customerId: string | null = null;

  try {
    const token = await loginAsTenantAdmin(request);
    await clearSyncEvents(request);

    const res = await request.post(`${BACKEND_URL}/customers/create`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      data: {
        tenant_id: DYNATIRE_ID,
        name: `${tag}-customer`,
        phone: uniquePhone(),
        email: `${tag}@example.test`,
      },
    });
    const body = await res.json();

    expect(res.status(), 'customer-create must succeed').toBe(200);
    expect(body.success).toBe(true);
    customerId = (body.customer as { customer_id: string }).customer_id;

    await new Promise((r) => setTimeout(r, 500));
    const events = await getSyncEvents(request);
    const matching = events.filter(
      (e) => e.entity === 'customer' && e.action === 'create' && e.entityId === customerId
    );
    expect(matching).toHaveLength(4);
    expect(matching.map((e) => e.provider).sort()).toEqual(
      ['hubspot', 'jobber', 'servicetitan', 'square']
    );
    expect(
      matching.find((e) => e.provider === 'calendar'),
      'calendars must NOT receive customer events'
    ).toBeUndefined();
  } finally {
    if (customerId) await pool.query('DELETE FROM customers WHERE customer_id = $1', [customerId]);
  }
});

test('customer-update + customer-delete each dispatch all 4 CRMs', async ({ request }) => {
  // WHO: operator updates a customer's name, then later deletes the record
  // WHAT: both lifecycle events fire 4 'update' / 'delete' dispatches
  // WHY: collapse two related assertions into one test to keep the
  //        spec count manageable — the dispatch contract is identical
  //        between update and delete, only the action label differs
  const tag = uniqueTag();
  const phone = uniquePhone();
  let customerId: string | null = null;

  try {
    const cIns = await pool.query(
      `INSERT INTO customers (tenant_id, name, phone) VALUES ($1, $2, $3) RETURNING customer_id`,
      [DYNATIRE_ID, `${tag}-cust`, phone]
    );
    customerId = cIns.rows[0].customer_id;

    const token = await loginAsTenantAdmin(request);
    await clearSyncEvents(request);

    // Update phase. The /customers/:id PUT handler overwrites every
    // column with the body — phone is NOT NULL, so we round-trip the
    // original phone or the constraint trips and the dispatch never
    // happens.
    const up = await request.put(`${BACKEND_URL}/customers/${customerId}`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      data: { name: `${tag}-renamed`, phone },
    });
    expect(up.status(), 'update must succeed').toBe(200);

    await new Promise((r) => setTimeout(r, 500));
    let events = await getSyncEvents(request);
    let matching = events.filter(
      (e) => e.entity === 'customer' && e.action === 'update' && e.entityId === customerId
    );
    expect(matching).toHaveLength(4);

    // Delete phase — clear and re-assert.
    await clearSyncEvents(request);
    const del = await request.delete(`${BACKEND_URL}/customers/${customerId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.status(), 'delete must succeed').toBe(200);

    await new Promise((r) => setTimeout(r, 500));
    events = await getSyncEvents(request);
    matching = events.filter(
      (e) => e.entity === 'customer' && e.action === 'delete' && e.entityId === customerId
    );
    expect(matching).toHaveLength(4);
    customerId = null; // already deleted
  } finally {
    if (customerId) await pool.query('DELETE FROM customers WHERE customer_id = $1', [customerId]);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Fire-and-forget contract — HTTP returns fast even with sync running
// ────────────────────────────────────────────────────────────────────────────

test('fire-and-forget: HTTP response does not wait for sync provider work', async ({ request }) => {
  // WHO: any operator booking an appointment under a slow CRM
  // WHAT: /appointments/create returns within 3s even though 5 sync
  //        provider promises are still in flight
  // WHY: the orchestrator IS fire-and-forget by contract. If a future
  //        refactor accidentally awaits the dispatch promises, every
  //        booking call latency would balloon by Σ(provider latency).
  //        For 4 CRMs over WAN that's easily 8-20 seconds — completely
  //        unacceptable for a phone-call use case.
  const tag = uniqueTag();
  const apptIdsToCleanup: string[] = [];
  let scheduleSeeded = false;
  let customerId: string | null = null;

  // Hoisted out of `try` (pilot #3, 2026-05-18) so the `finally` cleanup
  // can pass mikeId into the composite-key DELETE.
  let mikeId: string | null = null;

  try {
    mikeId = await findEmployeeIdByName('Mike Rivera');
    const truckId = await findResourceIdByName('Truck 1');
    const cIns = await pool.query(
      `INSERT INTO customers (tenant_id, name, phone) VALUES ($1, $2, $3) RETURNING customer_id`,
      [DYNATIRE_ID, `${tag}-cust`, uniquePhone()]
    );
    customerId = cIns.rows[0].customer_id;
    await pool.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1, $2, $3, '09:00', '17:00', false)
       ON CONFLICT (tenant_id, employee_id, shift_date) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
      [DYNATIRE_ID, mikeId, FUTURE_DATE]
    );
    scheduleSeeded = true;

    const token = await loginAsTenantAdmin(request);
    await clearSyncEvents(request);

    const t0 = Date.now();
    const res = await request.post(`${BACKEND_URL}/appointments/create`, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      data: {
        tenant_id: DYNATIRE_ID,
        resource_id: truckId,
        customer_id: customerId,
        employee_id: mikeId,
        // 17:00 UTC = 12:00 CDT — squarely inside Mike's 09:00-17:00 local
        // shift on the FUTURE_DATE, doesn't collide with the 14:00 UTC
        // (09:00 CDT) used by appointment-create earlier in this file.
        start_time: `${FUTURE_DATE}T17:00:00.000Z`,
        end_time: `${FUTURE_DATE}T17:30:00.000Z`,
        description: tag,
      },
    });
    const elapsed = Date.now() - t0;
    const body = await res.json();

    expect(res.status(), 'create must succeed').toBe(200);
    if (body.appointment_id) apptIdsToCleanup.push(body.appointment_id as string);

    // 3000ms is generous given local-only providers. Real prod traffic
    // adding seconds for external HTTPS would trip this immediately if
    // the dispatch ever became blocking.
    expect(elapsed, `HTTP must return in <3s; took ${elapsed}ms`).toBeLessThan(3000);

    // And the orchestrator did fire — proving the speed isn't because
    // the dispatch was skipped.
    await new Promise((r) => setTimeout(r, 500));
    const events = await getSyncEvents(request);
    expect(events.filter((e) => e.entity === 'appointment').length).toBeGreaterThanOrEqual(5);
  } finally {
    for (const id of apptIdsToCleanup) await pool.query('DELETE FROM appointments WHERE appointment_id = $1', [id]);
    if (scheduleSeeded && mikeId) await pool.query('DELETE FROM employee_schedule WHERE tenant_id = $1 AND employee_id = $2 AND shift_date = $3', [DYNATIRE_ID, mikeId, FUTURE_DATE]);
    if (customerId) await pool.query('DELETE FROM customers WHERE customer_id = $1', [customerId]);
  }
});
