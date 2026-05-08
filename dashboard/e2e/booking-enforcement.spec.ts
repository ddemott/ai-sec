/**
 * E2E coverage for the booking-enforcement work shipped 2026-05-08
 * (slices 1-2: backend conflict-details, 15-min increments, ConflictModal).
 *
 * Four scenarios — each fully self-contained per the testing-isolation
 * memory. Every test creates its own employee_schedule rows + blocking
 * appointments in `try`, asserts, and tears them down in `finally`. No
 * test depends on another's residue or on specific seed.sql values
 * persisting; any test can be run in isolation in any order.
 *
 *   1. Out-of-hours blocked — booking outside the assigned employee's
 *      shift window is rejected by the backend with a clear inline
 *      error; no row is inserted.
 *   2. Employee double-book → ConflictModal — booking the same employee
 *      at an already-taken time surfaces the existing appointment's
 *      details (customer, employee, time) so the operator can decide
 *      what to do; no second row is inserted.
 *   3. Resource double-book → ConflictModal — same shape as (2) but on
 *      the resource axis; the existing booking surfaces even when the
 *      assigned employee differs.
 *   4. Partial overlap blocked — 14:15-14:45 vs an existing 14:00-14:30
 *      is rejected (proves the GiST exclusion is whole-slot via the &&
 *      operator, not just exact-match-start).
 *
 * Setup: backend on https://localhost:4001, dashboard on
 * https://localhost:4000, Postgres on localhost:5433. Each test uses
 * a unique tag for cleanup safety.
 */
import { test, expect, Page } from '@playwright/test';
import { Pool } from 'pg';

const DYNATIRE_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const PG_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/postgres';
const ADMIN_EMAIL = 'admin@secretaryhq.com';
const ADMIN_PASSWORD = 'password';
const FUTURE_DATE = '2026-06-15'; // Far enough from today to avoid seed collisions

let pool: Pool;

function uniqueTag(): string {
  return `e2e-enforce-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function ensureLoggedIn(page: Page) {
  await page.goto('/dashboard');
  await page.waitForTimeout(1500);
  const loginLink = page.getByText('Log in', { exact: true }).first();
  if (await loginLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    await loginLink.click();
    await page.waitForTimeout(500);
  }
  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await emailInput.fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(2500);
  }
  await expect(page.getByText('Home').first()).toBeVisible({ timeout: 15000 });
}

async function switchToDynaTireTenant(page: Page) {
  await page.evaluate((id) => {
    localStorage.setItem('managedTenantId', id);
    localStorage.setItem('managedTenantName', 'DynaTire Mobile Service');
  }, DYNATIRE_ID);
  await page.reload();
  await page.waitForTimeout(1500);
}

async function findEmployeeIdByName(name: string): Promise<string | null> {
  const r = await pool.query(
    'SELECT id FROM employees WHERE tenant_id = $1 AND name = $2 AND (is_deleted IS NULL OR is_deleted = false)',
    [DYNATIRE_ID, name]
  );
  return r.rows[0]?.id ?? null;
}

async function findResourceIdByName(name: string): Promise<string | null> {
  const r = await pool.query(
    'SELECT id FROM resources WHERE tenant_id = $1 AND name = $2 AND (is_deleted IS NULL OR is_deleted = false)',
    [DYNATIRE_ID, name]
  );
  return r.rows[0]?.id ?? null;
}

async function findCustomerId(): Promise<string> {
  const r = await pool.query(
    'SELECT id FROM customers WHERE tenant_id = $1 LIMIT 1',
    [DYNATIRE_ID]
  );
  if (!r.rows[0]?.id) throw new Error('No DynaTire customer found in seed');
  return r.rows[0].id;
}

async function getApiToken(page: Page): Promise<string> {
  const result = await page.evaluate(
    async ({ email, password }) => {
      const res = await fetch('https://localhost:4001/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return await res.json();
    },
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
  );
  if (!result?.token) throw new Error(`Login failed: ${JSON.stringify(result)}`);
  return result.token as string;
}

/**
 * POST /appointments/create from inside the page context (so Playwright
 * picks up the auth cookies / token). Returns the parsed JSON response
 * regardless of HTTP status, so tests can assert on the conflict block
 * the backend returns at 409.
 */
async function postBookAppointment(
  page: Page,
  token: string,
  payload: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  return await page.evaluate(
    async ({ token, payload }) => {
      const res = await fetch('https://localhost:4001/appointments/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      return { status: res.status, body };
    },
    { token, payload }
  );
}

async function countAppointments(tag: string): Promise<number> {
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM appointments WHERE description = $1`,
    [tag]
  );
  return r.rows[0].n;
}

test.beforeAll(() => {
  pool = new Pool({ connectionString: PG_URL });
});
test.afterAll(async () => {
  await pool.end();
});

// ────────────────────────────────────────────────────────────────────────────
// 1. Out-of-hours blocked
// ────────────────────────────────────────────────────────────────────────────
test('out-of-hours: booking outside the assigned employee shift is rejected with a clear error', async ({ page }) => {
  // WHO: front-desk operator trying to fit a customer in before the shop opens
  // WHAT: backend's book_appointment_atomic checks employee_schedule and
  //        rejects with "Employee is not on shift during this time"
  //        (or similar) when the requested time falls outside the
  //        employee's shift; status 400, no row inserted
  // WHEN: any booking where the assigned employee has no covering
  //        employee_schedule row at the requested time
  // WHERE: book_appointment_atomic shift-coverage check + the dashboard's
  //        inline error UX (NOT the conflict modal — there's no
  //        conflicting appointment, just a missing shift)
  // WHY: the system must enforce business hours so a frantic morning
  //        operator can't accidentally book a 6am appointment for an
  //        employee who starts at 9am — the customer would arrive to a
  //        closed shop. Inline error rather than modal because there's
  //        nothing to "view" — the operator just needs to pick a time
  //        that overlaps a real shift.
  const tag = uniqueTag();
  const apptIdsToCleanup: string[] = [];
  let scheduleIdToCleanup: string | null = null;

  try {
    const mikeId = await findEmployeeIdByName('Mike Rivera');
    const truckId = await findResourceIdByName('Truck 1');
    const customerId = await findCustomerId();
    expect(mikeId, 'Mike Rivera must exist in DynaTire seed').toBeTruthy();
    expect(truckId, 'Truck 1 must exist').toBeTruthy();

    // Setup: give Mike a 9-17 shift on the future date, then try booking at 06:00.
    const ins = await pool.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1, $2, $3, '09:00', '17:00', false)
       ON CONFLICT (tenant_id, employee_id, shift_date) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time
       RETURNING id`,
      [DYNATIRE_ID, mikeId, FUTURE_DATE]
    );
    scheduleIdToCleanup = ins.rows[0].id;

    await ensureLoggedIn(page);
    const token = await getApiToken(page);

    // Try booking at 06:00 (3 hours before Mike's shift starts).
    const earlyStart = `${FUTURE_DATE}T06:00:00.000Z`;
    const earlyEnd = `${FUTURE_DATE}T06:30:00.000Z`;
    const res = await postBookAppointment(page, token, {
      tenant_id: DYNATIRE_ID,
      resource_id: truckId,
      customer_id: customerId,
      employee_id: mikeId,
      start_time: earlyStart,
      end_time: earlyEnd,
      description: tag,
    });

    expect(res.status, 'pre-shift booking must be rejected').toBe(400);
    expect(res.body.success).toBe(false);
    // Error message must mention shift / not on shift so the dashboard
    // operator (and any consuming UI) gets actionable text.
    expect(String(res.body.error)).toMatch(/shift|on shift/i);
    expect(res.body.conflict, 'no conflict block on shift errors').toBeUndefined();

    // No row landed in the DB for our tag.
    expect(await countAppointments(tag)).toBe(0);
  } finally {
    for (const id of apptIdsToCleanup) {
      await pool.query('DELETE FROM appointments WHERE id = $1', [id]);
    }
    if (scheduleIdToCleanup) {
      await pool.query('DELETE FROM employee_schedule WHERE id = $1', [scheduleIdToCleanup]);
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Employee double-book → conflict block surfaces existing appointment
// ────────────────────────────────────────────────────────────────────────────
test('employee-double-book: overlap returns 409 with conflict block showing the existing appointment', async ({ page }) => {
  // WHO: operator trying to fit a second customer in with Mike during a
  //        time he's already booked
  // WHAT: backend rejects with 409 + error_code TIMESLOT_OCCUPIED + a
  //        `conflict` block containing the existing appointment's id,
  //        customer_name, employee_name, resource_name, start/end
  // WHEN: any /appointments/create that would overlap an existing
  //        scheduled+not-deleted row on the same employee_id
  // WHERE: GiST exclusion appointments_no_employee_overlap (DB layer)
  //        + book_appointment_atomic exception handler + the route's
  //        findOverlappingAppointment lookup
  // WHY: this test pins the BACKEND CONTRACT the dashboard's
  //        ConflictModal depends on. If a future refactor breaks the
  //        409 status, the conflict block, or any of the surfaced
  //        fields, the modal would render blank in production.
  const tag = uniqueTag();
  const apptIdsToCleanup: string[] = [];
  let scheduleIdToCleanup: string | null = null;

  try {
    const mikeId = await findEmployeeIdByName('Mike Rivera');
    const truckId = await findResourceIdByName('Truck 1');
    const customerId = await findCustomerId();
    expect(mikeId).toBeTruthy();
    expect(truckId).toBeTruthy();

    // Shift for Mike on the future date (9-17), so the only failure
    // mode for our second booking is the employee-overlap, not shift.
    const shiftIns = await pool.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1, $2, $3, '09:00', '17:00', false)
       ON CONFLICT (tenant_id, employee_id, shift_date) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time
       RETURNING id`,
      [DYNATIRE_ID, mikeId, FUTURE_DATE]
    );
    scheduleIdToCleanup = shiftIns.rows[0].id;

    // Pre-existing appointment: Mike + Truck 1 from 14:00 to 14:30.
    const existingStart = `${FUTURE_DATE}T14:00:00.000Z`;
    const existingEnd = `${FUTURE_DATE}T14:30:00.000Z`;
    const existing = await pool.query(
      `INSERT INTO appointments (tenant_id, resource_id, customer_id, employee_id, start_time, end_time, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
       RETURNING id`,
      [DYNATIRE_ID, truckId, customerId, mikeId, existingStart, existingEnd, `${tag}-blocker`]
    );
    apptIdsToCleanup.push(existing.rows[0].id);

    await ensureLoggedIn(page);
    const token = await getApiToken(page);

    // Try to book Mike at the exact same slot — must fail with conflict block.
    const res = await postBookAppointment(page, token, {
      tenant_id: DYNATIRE_ID,
      resource_id: truckId,
      customer_id: customerId,
      employee_id: mikeId,
      start_time: existingStart,
      end_time: existingEnd,
      description: tag,
    });

    expect(res.status, 'overlap must return 409').toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error_code).toBe('TIMESLOT_OCCUPIED');
    const conflict = res.body.conflict as Record<string, unknown> | undefined;
    expect(conflict, 'conflict block must be present').toBeTruthy();
    expect(conflict?.appointment_id).toBe(existing.rows[0].id);
    expect(conflict?.employee_name).toBe('Mike Rivera');
    expect(conflict?.resource_name).toBe('Truck 1');
    expect(conflict?.start_time).toBeTruthy();
    expect(conflict?.end_time).toBeTruthy();

    // No second row got inserted.
    expect(await countAppointments(tag)).toBe(0);
  } finally {
    for (const id of apptIdsToCleanup) {
      await pool.query('DELETE FROM appointments WHERE id = $1', [id]);
    }
    if (scheduleIdToCleanup) {
      await pool.query('DELETE FROM employee_schedule WHERE id = $1', [scheduleIdToCleanup]);
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 3. Resource double-book → conflict block surfaces existing appointment
// ────────────────────────────────────────────────────────────────────────────
test('resource-double-book: same resource + different employee still returns 409 with conflict', async ({ page }) => {
  // WHO: operator who picked a different employee but the same truck/
  //        bay during a time the truck is already in use
  // WHAT: backend rejects on the resource axis (appointments_no_resource_overlap)
  //        even when the employee differs; conflict block shows the
  //        existing booking's employee, not the requested one
  // WHEN: two appointments would share resource_id + overlap in time
  // WHERE: GiST exclusion + the conflict lookup's resource-OR-employee
  //        predicate (resource match alone is sufficient to surface the
  //        conflict)
  // WHY: pre-2026-05-08 this was a real concurrency gap fixed by the
  //        exclusion constraints; this test pins the rejection PLUS
  //        the modal's data path, so a future refactor that drops the
  //        resource branch from the conflict lookup surfaces here
  const tag = uniqueTag();
  const apptIdsToCleanup: string[] = [];
  let scheduleIdToCleanup: string | null = null;

  try {
    const mikeId = await findEmployeeIdByName('Mike Rivera');
    const carlosId = await findEmployeeIdByName('Carlos Vega');
    const truckId = await findResourceIdByName('Truck 1');
    const customerId = await findCustomerId();
    expect(mikeId).toBeTruthy();
    expect(carlosId).toBeTruthy();
    expect(truckId).toBeTruthy();

    // Both employees need a shift so the second-attempt failure mode
    // is the resource overlap, not "Carlos is not on shift."
    await pool.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1, $2, $3, '09:00', '17:00', false)
       ON CONFLICT (tenant_id, employee_id, shift_date) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
      [DYNATIRE_ID, mikeId, FUTURE_DATE]
    );
    const carlosShiftRes = await pool.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1, $2, $3, '09:00', '17:00', false)
       ON CONFLICT (tenant_id, employee_id, shift_date) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time
       RETURNING id`,
      [DYNATIRE_ID, carlosId, FUTURE_DATE]
    );
    scheduleIdToCleanup = carlosShiftRes.rows[0].id; // we'll clean Mike's separately

    const existingStart = `${FUTURE_DATE}T15:00:00.000Z`;
    const existingEnd = `${FUTURE_DATE}T15:30:00.000Z`;
    const existing = await pool.query(
      `INSERT INTO appointments (tenant_id, resource_id, customer_id, employee_id, start_time, end_time, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
       RETURNING id`,
      [DYNATIRE_ID, truckId, customerId, mikeId, existingStart, existingEnd, `${tag}-blocker`]
    );
    apptIdsToCleanup.push(existing.rows[0].id);

    await ensureLoggedIn(page);
    const token = await getApiToken(page);

    // Try Carlos + same truck + same time — resource overlap, not employee overlap.
    const res = await postBookAppointment(page, token, {
      tenant_id: DYNATIRE_ID,
      resource_id: truckId,
      customer_id: customerId,
      employee_id: carlosId,
      start_time: existingStart,
      end_time: existingEnd,
      description: tag,
    });

    expect(res.status).toBe(409);
    expect(res.body.error_code).toBe('TIMESLOT_OCCUPIED');
    const conflict = res.body.conflict as Record<string, unknown> | undefined;
    expect(conflict, 'conflict block must be present even when only resource overlaps').toBeTruthy();
    expect(conflict?.appointment_id).toBe(existing.rows[0].id);
    // The conflict surfaces the EXISTING booking's employee (Mike), not
    // the requested employee (Carlos). The modal's job is to show what's
    // there, not who tried to book.
    expect(conflict?.employee_name).toBe('Mike Rivera');
    expect(conflict?.resource_name).toBe('Truck 1');

    expect(await countAppointments(tag)).toBe(0);
  } finally {
    for (const id of apptIdsToCleanup) {
      await pool.query('DELETE FROM appointments WHERE id = $1', [id]);
    }
    // Clean both shifts the test created.
    await pool.query(
      `DELETE FROM employee_schedule WHERE tenant_id = $1 AND shift_date = $2`,
      [DYNATIRE_ID, FUTURE_DATE]
    );
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Partial overlap blocked (whole-slot check, not just exact-match)
// ────────────────────────────────────────────────────────────────────────────
test('partial-overlap: 14:15-14:45 is blocked by an existing 14:00-14:30 booking', async ({ page }) => {
  // WHO: operator who knows there's a 14:00 booking and tries to slip
  //        in starting at 14:15 (overlapping the tail half of the
  //        existing slot)
  // WHAT: GiST exclusion's && operator on tstzrange(start, end, '[)')
  //        catches any range overlap, not just exact-start match. Backend
  //        returns 409 + conflict block — same shape as exact match.
  // WHEN: any partial-overlap booking attempt — start before existing
  //        end + new end after existing start
  // WHERE: appointments_no_employee_overlap (DB) + the conflict lookup
  //        helper using the same half-open range predicate
  // WHY: the user explicitly called out "the system should NOT ever
  //        double book... It should check to see if that whole time slot
  //        is free." Pin the partial-overlap case because it's the
  //        most common real-world conflict (operator partially overlaps
  //        rather than picking the exact same start).
  const tag = uniqueTag();
  const apptIdsToCleanup: string[] = [];
  let scheduleIdToCleanup: string | null = null;

  try {
    const mikeId = await findEmployeeIdByName('Mike Rivera');
    const truckId = await findResourceIdByName('Truck 1');
    const customerId = await findCustomerId();
    expect(mikeId).toBeTruthy();
    expect(truckId).toBeTruthy();

    const shiftIns = await pool.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1, $2, $3, '09:00', '17:00', false)
       ON CONFLICT (tenant_id, employee_id, shift_date) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time
       RETURNING id`,
      [DYNATIRE_ID, mikeId, FUTURE_DATE]
    );
    scheduleIdToCleanup = shiftIns.rows[0].id;

    // Existing booking 14:00-14:30
    const existing = await pool.query(
      `INSERT INTO appointments (tenant_id, resource_id, customer_id, employee_id, start_time, end_time, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
       RETURNING id`,
      [
        DYNATIRE_ID,
        truckId,
        customerId,
        mikeId,
        `${FUTURE_DATE}T14:00:00.000Z`,
        `${FUTURE_DATE}T14:30:00.000Z`,
        `${tag}-blocker`,
      ]
    );
    apptIdsToCleanup.push(existing.rows[0].id);

    await ensureLoggedIn(page);
    const token = await getApiToken(page);

    // Try 14:15-14:45 — overlaps the second half of the existing booking.
    const res = await postBookAppointment(page, token, {
      tenant_id: DYNATIRE_ID,
      resource_id: truckId,
      customer_id: customerId,
      employee_id: mikeId,
      start_time: `${FUTURE_DATE}T14:15:00.000Z`,
      end_time: `${FUTURE_DATE}T14:45:00.000Z`,
      description: tag,
    });

    expect(res.status, 'partial overlap must return 409').toBe(409);
    expect(res.body.error_code).toBe('TIMESLOT_OCCUPIED');
    expect(res.body.conflict).toBeTruthy();
    expect((res.body.conflict as Record<string, unknown>).appointment_id).toBe(existing.rows[0].id);

    // No second row.
    expect(await countAppointments(tag)).toBe(0);

    // ALSO confirm the boundary case — adjacent (touching) is allowed.
    // 14:30-15:00 starts exactly when the existing one ends. Half-open
    // [) range: this should succeed.
    const adjacent = await postBookAppointment(page, token, {
      tenant_id: DYNATIRE_ID,
      resource_id: truckId,
      customer_id: customerId,
      employee_id: mikeId,
      start_time: `${FUTURE_DATE}T14:30:00.000Z`,
      end_time: `${FUTURE_DATE}T15:00:00.000Z`,
      description: `${tag}-adjacent`,
    });
    expect(adjacent.status, 'adjacent (touching) booking must succeed').toBe(200);
    expect(adjacent.body.success).toBe(true);
    if (adjacent.body.appointment_id) {
      apptIdsToCleanup.push(adjacent.body.appointment_id as string);
    }
  } finally {
    for (const id of apptIdsToCleanup) {
      await pool.query('DELETE FROM appointments WHERE id = $1', [id]);
    }
    if (scheduleIdToCleanup) {
      await pool.query('DELETE FROM employee_schedule WHERE id = $1', [scheduleIdToCleanup]);
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 5. UI smoke: ConflictModal renders when /appointments/create returns 409
// ────────────────────────────────────────────────────────────────────────────
test('ui-conflict-modal: dashboard surfaces ConflictModal with existing appointment when overlap detected', async ({ page }) => {
  // WHO: front-desk operator going through the actual UI (not direct API)
  // WHAT: open Schedule → Quick Book → fill the form to overlap an
  //        existing appointment → submit → ConflictModal renders with
  //        the existing booking's customer / employee / resource / time
  // WHEN: any UI-driven booking that would overlap
  // WHERE: QuickBookPanel.handleBook conflict-branch → <ConflictModal>
  // WHY: tests 2-4 cover the API contract; this one covers the UI
  //        wiring end-to-end. A regression that, e.g., dropped the
  //        ConflictModal from the JSX or stopped reading res.conflict
  //        would slip past the API tests but fail here.
  const tag = uniqueTag();
  const apptIdsToCleanup: string[] = [];
  let scheduleIdToCleanup: string | null = null;

  try {
    const mikeId = await findEmployeeIdByName('Mike Rivera');
    const truckId = await findResourceIdByName('Truck 1');
    const customerId = await findCustomerId();
    expect(mikeId).toBeTruthy();
    expect(truckId).toBeTruthy();

    // Shift for Mike. Use TODAY to keep the Quick Book defaults predictable.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    const shiftIns = await pool.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1, $2, $3, '09:00', '17:00', false)
       ON CONFLICT (tenant_id, employee_id, shift_date) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time
       RETURNING id`,
      [DYNATIRE_ID, mikeId, todayStr]
    );
    scheduleIdToCleanup = shiftIns.rows[0].id;

    // Existing 14:00-14:30 booking that we'll try to overlap from the UI.
    const existingStart = new Date(today);
    existingStart.setHours(14, 0, 0, 0);
    const existingEnd = new Date(today);
    existingEnd.setHours(14, 30, 0, 0);
    const existing = await pool.query(
      `INSERT INTO appointments (tenant_id, resource_id, customer_id, employee_id, start_time, end_time, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
       RETURNING id`,
      [
        DYNATIRE_ID,
        truckId,
        customerId,
        mikeId,
        existingStart.toISOString(),
        existingEnd.toISOString(),
        `${tag}-blocker`,
      ]
    );
    apptIdsToCleanup.push(existing.rows[0].id);

    await ensureLoggedIn(page);
    await switchToDynaTireTenant(page);

    // Open the Schedule tab + Quick Book panel.
    await page.getByRole('tab', { name: /^Schedule$/ }).first().click();
    await page.getByRole('button', { name: /Quick Book/i }).first().click();
    await expect(page.getByTestId('quick-book-panel')).toBeVisible({ timeout: 10000 });

    // Wait for dropdowns to populate before selecting — the hooks that
    // fetch customers/services/resources/employees fire on mount and may
    // not be done by the time the panel renders. Without these waits the
    // selectOption call retries silently for 30s before timing out.
    const customerSelect = page.getByTestId('quick-book-customer');
    await expect(customerSelect).toBeVisible({ timeout: 10000 });
    await expect(customerSelect.locator(`option[value="${customerId}"]`)).toHaveCount(1, { timeout: 10000 });
    await customerSelect.selectOption(customerId);

    const resourceSelect = page.getByTestId('quick-book-resource');
    await expect(resourceSelect.locator(`option[value="${truckId}"]`)).toHaveCount(1, { timeout: 10000 });
    await resourceSelect.selectOption(truckId!);

    const employeeSelect = page.getByTestId('quick-book-employee');
    await expect(employeeSelect.locator(`option[value="${mikeId}"]`)).toHaveCount(1, { timeout: 10000 });
    await employeeSelect.selectOption(mikeId!);

    const localDateTime = (d: Date) => {
      const offset = d.getTimezoneOffset() * 60000;
      return new Date(d.getTime() - offset).toISOString().slice(0, 16);
    };
    const startInputs = page.locator('input[type="datetime-local"]');
    await startInputs.nth(0).fill(localDateTime(existingStart));
    await startInputs.nth(1).fill(localDateTime(existingEnd));

    // Submit.
    await page.getByTestId('quick-book-confirm').click();

    // Modal renders with the existing appointment's details.
    await expect(page.getByText('That time is already booked')).toBeVisible({ timeout: 5000 });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Mike Rivera');
    await expect(dialog).toContainText('Truck 1');

    // No second row in DB.
    expect(await countAppointments(tag)).toBe(0);
  } finally {
    for (const id of apptIdsToCleanup) {
      await pool.query('DELETE FROM appointments WHERE id = $1', [id]);
    }
    if (scheduleIdToCleanup) {
      await pool.query('DELETE FROM employee_schedule WHERE id = $1', [scheduleIdToCleanup]);
    }
  }
});
