/**
 * End-to-end happy-path workflow tests.
 *
 * Each test is independent and cleans up after itself:
 *  - Records are tagged with a unique e2e- prefix per run.
 *  - try/finally guarantees DB cleanup even when an assertion fails.
 *  - No test relies on data created by another.
 *
 * Setup: backend on https://localhost:4001, dashboard on https://localhost:4000,
 * Postgres on localhost:5433 with DynaTire seed data.
 */
import { test, expect, Page } from '@playwright/test';
import { Pool } from 'pg';

const DYNATIRE_ID = 'f234e471-0e60-4163-86c9-93cfd9338e3a';
const PG_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/postgres';
// bcrypt of "password" — same hash used in supabase/seed.sql.
const SEED_PASSWORD_HASH = '$2b$10$hUTzgdpUJwodudEw.p2SXu5.k60elGfP0NoTZ8ly2oj4xXaWfpKfK';

let pool: Pool;
test.beforeAll(() => { pool = new Pool({ connectionString: PG_URL }); });
test.afterAll(async () => { await pool.end(); });

function uniqueTag(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/** Format a Date as YYYY-MM-DDTHH:mm in the LOCAL timezone (matches what
 * <input type="datetime-local"> expects). Avoid toISOString() — that's UTC. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Set super-admin's "managed tenant" to DynaTire so tenant-scoped UI loads.
 * Mirrors the helper in quick-book-shift-overrides.spec.ts.
 */
async function switchToDynaTireTenant(page: Page) {
  await page.evaluate((id) => {
    localStorage.setItem('managedTenantId', id);
    localStorage.setItem('managedTenantName', 'DynaTire Mobile Service');
  }, DYNATIRE_ID);
  await page.reload();
  await page.waitForTimeout(1500);
}

/**
 * Log out the shared admin and log in as a different user. Used by the
 * front-desk-gating and invite tests where the role of the caller is the
 * point of the test.
 */
async function loginAs(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto('/dashboard');
  await page.evaluate(() => { localStorage.clear(); });
  await page.goto('/dashboard');
  await page.waitForTimeout(1000);

  const loginLink = page.getByText('Log in', { exact: true }).first();
  if (await loginLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    await loginLink.click();
    await page.waitForTimeout(500);
  }
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('text=Home').first()).toBeVisible({ timeout: 15000 });
}

/** Login via API to get a JWT, then store it so page.evaluate(fetch) works. */
async function getApiToken(page: Page, email: string, password: string): Promise<string> {
  const result = await page.evaluate(async ({ email, password }) => {
    const res = await fetch('https://localhost:4001/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return await res.json();
  }, { email, password });
  if (!result?.token) throw new Error(`Login failed for ${email}: ${JSON.stringify(result)}`);
  return result.token as string;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. SMOKE — admin lands, sees Home, clicks Schedule, calendar renders
// ────────────────────────────────────────────────────────────────────────────
test('smoke: admin can load dashboard and view the schedule', async ({ page }) => {
  // WHO: super-admin | WHAT: navigate dashboard root → Schedule | WHERE: shell + SchedulerView
  // WHY: catches build/server drift like the stale-bundle issue we just hit
  await page.goto('/dashboard');
  await switchToDynaTireTenant(page);

  // Primary tabs visible
  await expect(page.getByRole('tab', { name: /^Home$/ }).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('tab', { name: /^Schedule$/ }).first()).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Customers$/ }).first()).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Calls$/ }).first()).toBeVisible();

  // Click Schedule — calendar (default sub-view) renders
  await page.getByRole('tab', { name: /^Schedule$/ }).first().click();
  await expect(page.locator('[data-testid="scheduler-view"]')).toBeVisible({ timeout: 10000 });

  // Seeded appointments visible somewhere on the page (a customer name from the seed)
  await expect(page.locator('text=/James Kowalski|Sarah Mitchell|Mike Anderson/i').first()).toBeVisible({ timeout: 10000 });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. QUICK BOOK — book an appointment via UI; verify in DB; cleanup
// ────────────────────────────────────────────────────────────────────────────
test('quick book: booking creates an appointment row and shows it in the DB', async ({ page }) => {
  // WHO: tenant owner via super-admin | WHAT: open Quick Book, pick fields, submit
  // WHERE: SchedulerView (Resources tab) → QuickBookPanel → POST /appointments
  // WHY: end-to-end proof that the new appointmentValidation + booking RPC chain works
  const tag = uniqueTag();
  const description = `${tag}-quickbook`;
  let createdId: string | null = null;

  try {
    await page.goto('/dashboard');
    await switchToDynaTireTenant(page);
    await page.getByRole('tab', { name: /^Schedule$/ }).first().click();
    await page.waitForTimeout(1000);

    // Switch to Resources view (where Quick Book lives)
    const resourcesTab = page.getByTestId('view-tab-resources');
    await expect(resourcesTab).toBeVisible({ timeout: 10000 });
    await resourcesTab.click();
    await page.waitForTimeout(500);

    const quickBookBtn = page.locator('button').filter({ hasText: 'Quick Book' }).first();
    await expect(quickBookBtn).toBeVisible({ timeout: 10000 });
    await quickBookBtn.click();

    const panel = page.getByTestId('quick-book-panel');
    await expect(panel).toBeVisible({ timeout: 5000 });

    // Pick first real option in each select. Customer + Service dropdowns
    // include a placeholder/prompt at index 0, so index 1 is the first
    // real option. Resource dropdown does NOT include a prompt — it lists
    // eligible resources directly (post-2026-05-07 alignment filter), so
    // index 0 is the first real resource. Some services in the seed are
    // mapped to a single resource (Balancing, New Tire Install → truck1
    // only), and using index 1 there would fail because no second option
    // exists. Pinning index 0 makes this work for any service.
    await page.getByTestId('quick-book-customer').selectOption({ index: 1 });
    await page.getByTestId('quick-book-service').selectOption({ index: 1 });
    await page.getByTestId('quick-book-resource').selectOption({ index: 0 });

    // Pick a 30-min slot a few days out at a random grid-aligned hour
    // within the SEED'S LOCAL business hours so the booking RPC's
    // shift-coverage check would pass if employee is assigned.
    //
    // Two real subtleties this test got bitten by:
    //
    // 1. Date reach. The seed's `employee_schedule` only extends ~12
    //    days from today (refresh-seed-data.sql, weekdays only). Booking
    //    further out fails with EMPLOYEE_NOT_SCHEDULED. We walk forward
    //    3 days, then skip Sat/Sun.
    //
    // 2. Local-vs-UTC. `<input type="datetime-local">` interprets the
    //    string we fill as LOCAL time, so we must hand it a LOCAL
    //    datetime string. `toISOString()` returns UTC, so calling it on
    //    a Date built from setHours() shifts the rendered hour by the
    //    machine's offset and silently pushes the booking outside the
    //    shop's local shift window (Mike 07-16, Carlos 08-17, Dana
    //    09-18). Format the string from the local components directly.
    //
    // Range 10-14 LOCAL gives us a safe corridor: even at the edges,
    // every seed employee has overlap with at least the resource we
    // pick, so the booking RPC's auto-assign always finds someone.
    const future = new Date();
    future.setDate(future.getDate() + 3);
    while (future.getDay() === 0 || future.getDay() === 6) {
      future.setDate(future.getDate() + 1);
    }
    const randomHour = 10 + Math.floor(Math.random() * 5); // 10-14 inclusive
    const ymd = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const hh = String(randomHour).padStart(2, '0');
    const startStr = `${ymd}T${hh}:15`;
    const endStr = `${ymd}T${hh}:45`;

    const startInput = panel.locator('input[type="datetime-local"]').first();
    const endInput = panel.locator('input[type="datetime-local"]').last();
    await startInput.fill(startStr);
    await endInput.fill(endStr);

    const beforeClick = new Date();
    await page.getByTestId('quick-book-confirm').click();

    // Wait for the panel to close (success) — booking can fail validly (e.g. no
    // employee skilled+scheduled at this time), so don't assert close. Instead
    // query the DB for any new row created since beforeClick.
    await page.waitForTimeout(2500);

    const dbRes = await pool.query(
      `SELECT id FROM appointments
        WHERE tenant_id = $1
          AND created_at >= $2
          AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT 1`,
      [DYNATIRE_ID, beforeClick.toISOString()],
    );
    expect(dbRes.rowCount, `expected a new appointment created after ${beforeClick.toISOString()}; tag=${description}`).toBeGreaterThanOrEqual(1);
    createdId = dbRes.rows[0].id;
  } finally {
    if (createdId) {
      await pool.query('DELETE FROM appointments WHERE id = $1', [createdId]);
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 2b. QUICK BOOK REAL-TIME — new appointment appears in the grid w/o reload
// ────────────────────────────────────────────────────────────────────────────
test('quick book real-time: new appointment appears in the scheduler grid without manual page reload', async ({ page }) => {
  // WHO: front-desk operator who just submitted a Quick Book and expects
  //        to see the appointment on the grid without doing anything else.
  // WHAT: open Quick Book → submit → assert the AppointmentBlock for the
  //        newly-created row becomes visible in the resource-columns grid
  //        WITHOUT a page reload (no page.reload() call, URL unchanged).
  //        The booking response's appointment_id is captured from the live
  //        POST /appointments/create response so the assertion targets the
  //        exact row that was just created (no name-collision noise).
  // WHEN: any successful Quick Book — the SchedulerView's handleQuickBooked
  //        callback calls useSchedulerData.refresh() which re-fetches the
  //        date's appointments. If that wiring breaks, the operator would
  //        book → see the panel close → and the grid would still look empty
  //        until they refresh the page — a real beta-stopping UX bug that
  //        unit tests would miss (refresh() is a useCallback closure that
  //        could be silently dropped from an effect's dep array).
  // WHERE: SchedulerView.handleQuickBooked → useSchedulerData.fetchData →
  //        Api.appointments.list → setAppointments → AppointmentBlock render.
  // WHY: the existing "quick book" test (above) verifies the BOOKING worked
  //        by checking the DB. This test verifies the GRID worked by checking
  //        the rendered UI. Both surfaces are required for the operator
  //        experience; either alone is insufficient.
  const tag = uniqueTag();
  let createdId: string | null = null;

  try {
    await page.goto('/dashboard');
    await switchToDynaTireTenant(page);
    await page.getByRole('tab', { name: /^Schedule$/ }).first().click();
    await page.waitForTimeout(1000);

    // Resources sub-view (where Quick Book + the resource-columns grid live)
    const resourcesTab = page.getByTestId('view-tab-resources');
    await expect(resourcesTab).toBeVisible({ timeout: 10000 });
    await resourcesTab.click();
    await page.waitForTimeout(500);

    // Compute target date: 3 weekdays forward (matching the existing quick
    // book test's date arithmetic). Then advance the scheduler's date nav by
    // that many clicks so selectedDate matches the booking date — otherwise
    // the new appointment lands outside the day-window useSchedulerData
    // queries and the grid wouldn't show it even with a correct refresh.
    const target = new Date();
    target.setDate(target.getDate() + 3);
    while (target.getDay() === 0 || target.getDay() === 6) {
      target.setDate(target.getDate() + 1);
    }
    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    const target0 = new Date(target);
    target0.setHours(0, 0, 0, 0);
    const daysForward = Math.round((target0.getTime() - today0.getTime()) / 86_400_000);
    const nextDayBtn = page.getByRole('button', { name: 'Next day' });
    for (let i = 0; i < daysForward; i++) {
      await nextDayBtn.click();
      await page.waitForTimeout(150);
    }

    // Capture URL before submission — assertion below confirms it didn't
    // change, i.e. no client-side route push and no reload.
    const urlBeforeBooking = page.url();

    // Open Quick Book + fill — same prefill pattern as the existing quick
    // book test (index 1 customer + service, index 0 resource, 10-14 local
    // hour) so this test fails for "real-time refresh broke" reasons, not
    // "I picked an unbookable combo" reasons.
    const quickBookBtn = page.locator('button').filter({ hasText: 'Quick Book' }).first();
    await expect(quickBookBtn).toBeVisible({ timeout: 10000 });
    await quickBookBtn.click();

    const panel = page.getByTestId('quick-book-panel');
    await expect(panel).toBeVisible({ timeout: 5000 });

    await page.getByTestId('quick-book-customer').selectOption({ index: 1 });
    await page.getByTestId('quick-book-service').selectOption({ index: 1 });
    await page.getByTestId('quick-book-resource').selectOption({ index: 0 });

    const randomHour = 10 + Math.floor(Math.random() * 5); // 10-14 LOCAL
    const ymd = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
    const hh = String(randomHour).padStart(2, '0');
    const startInput = panel.locator('input[type="datetime-local"]').first();
    const endInput = panel.locator('input[type="datetime-local"]').last();
    await startInput.fill(`${ymd}T${hh}:15`);
    await endInput.fill(`${ymd}T${hh}:45`);

    // Listen for the booking POST so we can grab the new appointment_id
    // directly from the same response the dashboard sees. This is more
    // reliable than "query DB for newest row" — there's no time-window
    // ambiguity.
    const bookingResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/appointments/create') && resp.request().method() === 'POST',
      { timeout: 10_000 }
    );
    await page.getByTestId('quick-book-confirm').click();
    const bookingResponse = await bookingResponsePromise;
    const bookingBody = await bookingResponse.json();
    expect(
      bookingBody.success,
      `booking must succeed for the real-time assertion to be meaningful; tag=${tag}, body=${JSON.stringify(bookingBody)}`
    ).toBe(true);
    expect(bookingBody.appointment_id, 'booking response must include appointment_id').toBeTruthy();
    createdId = bookingBody.appointment_id as string;

    // The actual contract: an AppointmentBlock for the new id must become
    // visible in the grid WITHOUT a page reload. Playwright's `toBeVisible`
    // auto-waits up to expect.timeout (10s) which is plenty of time for the
    // refetch + setAppointments + render cycle (typically <1s on a warm
    // backend).
    const newBlock = page.locator(`[data-testid="appointment-block-${createdId}"]`);
    await expect(
      newBlock,
      `the new appointment must render in the grid without a page reload; tag=${tag}`
    ).toBeVisible({ timeout: 10_000 });

    // Belt-and-suspenders: confirm no navigation/reload happened.
    expect(page.url(), 'URL must not change between booking submit and grid render').toBe(urlBeforeBooking);
  } finally {
    if (createdId) {
      await pool.query('DELETE FROM appointments WHERE id = $1', [createdId]);
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 3. EDIT APPOINTMENT — sad path validates, happy path saves to DB
// ────────────────────────────────────────────────────────────────────────────
test('edit appointment: time changes persist to DB through PUT /appointments', async ({ page }) => {
  // WHO: tenant owner | WHAT: load appt → change times → save → confirm DB
  // WHERE: AppointmentView → AppointmentDetailPanel → PUT /appointments/:id
  // WHY: end-to-end proof of the edit flow + new shared validateAppointmentTimeRange.
  // Sad-path validation is exercised by appointment.test.tsx (component test);
  // here we focus on the happy-path persistence loop.
  const tag = uniqueTag();
  const description = `${tag}-edit`;
  let apptId: string | null = null;
  let shiftId: string | null = null;

  try {
    // Pre-create via direct INSERT (no booking-RPC noise) — pick a future
    // weekday slot. Per the test-isolation principle: also ensure the
    // assigned employee has a shift covering that day, otherwise the row
    // is operationally inconsistent ("appointment exists for an employee
    // who isn't working") and any future cross-check that re-validates
    // existing rows against shift coverage would flag it. The test owns
    // the shift and the appointment together; both come and go together.
    const future = new Date();
    future.setDate(future.getDate() + 14);
    // Snap to next weekday in case getDate()+14 lands on a Sat/Sun.
    while (future.getDay() === 0 || future.getDay() === 6) {
      future.setDate(future.getDate() + 1);
    }
    future.setHours(10, 0, 0, 0);
    const startIso = future.toISOString();
    future.setHours(11, 0, 0, 0);
    const endIso = future.toISOString();
    const shiftDate = future.toISOString().slice(0, 10);

    const customer = await pool.query(
      `SELECT id FROM customers WHERE tenant_id = $1 LIMIT 1`,
      [DYNATIRE_ID],
    );
    const resource = await pool.query(
      `SELECT id FROM resources WHERE tenant_id = $1 LIMIT 1`,
      [DYNATIRE_ID],
    );
    const employee = await pool.query(
      `SELECT id FROM employees WHERE tenant_id = $1 AND name = 'Mike Rivera' LIMIT 1`,
      [DYNATIRE_ID],
    );
    expect(employee.rowCount, 'Mike Rivera must exist in DynaTire seed').toBe(1);

    // Insert (or upsert) Mike's shift covering the test slot. ON CONFLICT
    // guard against parallel-test residue or seed already having a row.
    const shiftRes = await pool.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1, $2, $3, '08:00', '17:00', false)
       ON CONFLICT (tenant_id, employee_id, shift_date) DO UPDATE
         SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, is_off = false
       RETURNING id`,
      [DYNATIRE_ID, employee.rows[0].id, shiftDate],
    );
    shiftId = shiftRes.rows[0].id;

    const insert = await pool.query(
      `INSERT INTO appointments (tenant_id, customer_id, resource_id, employee_id, start_time, end_time, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled') RETURNING id`,
      [DYNATIRE_ID, customer.rows[0].id, resource.rows[0].id, employee.rows[0].id, startIso, endIso, description],
    );
    apptId = insert.rows[0].id;

    // Edit via API (reuses the same PUT /appointments/:id route the UI calls).
    // We don't drive the form because (a) controlled-input fills don't reliably
    // dispatch React's onChange under Playwright, and (b) there's a real
    // z-index bug where react-big-calendar's date cells intercept clicks on
    // the confirmation modal. Both are tracked separately; the form path is
    // covered by appointment.test.tsx (component-level).
    const token = await getApiToken(page, 'admin@dynatire.com', 'password');
    const newStart = new Date(future);
    newStart.setHours(13, 0, 0, 0);
    const newEnd = new Date(future);
    newEnd.setHours(14, 0, 0, 0);
    const updateResp = await page.evaluate(async ({ token, id, tenantId, startIso, endIso }) => {
      const res = await fetch(`https://localhost:4001/appointments/${id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId, start_time: startIso, end_time: endIso }),
      });
      return { status: res.status, body: await res.json() };
    }, { token, id: apptId, tenantId: DYNATIRE_ID, startIso: newStart.toISOString(), endIso: newEnd.toISOString() });
    expect(updateResp.status, `update response: ${JSON.stringify(updateResp)}`).toBeLessThan(400);

    // SAD path: API rejects end <= start
    const badResp = await page.evaluate(async ({ token, id, tenantId, startIso }) => {
      const earlier = new Date(startIso);
      earlier.setHours(earlier.getHours() - 2);
      const res = await fetch(`https://localhost:4001/appointments/${id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId, end_time: earlier.toISOString() }),
      });
      return { status: res.status, body: await res.json() };
    }, { token, id: apptId, tenantId: DYNATIRE_ID, startIso: newStart.toISOString() });
    expect(badResp.status, 'expected 400 from validator on end<=start').toBe(400);
    expect(String(badResp.body?.error || '')).toMatch(/End time must be after start time/i);

    // Verify DB reflects the *valid* update (sad-path was rejected)
    const after = await pool.query(
      `SELECT EXTRACT(EPOCH FROM start_time) AS s, EXTRACT(EPOCH FROM end_time) AS e
         FROM appointments WHERE id = $1`,
      [apptId],
    );
    expect(after.rowCount).toBe(1);
    expect(Number(after.rows[0].s) * 1000).toBe(newStart.getTime());
    expect(Number(after.rows[0].e) * 1000).toBe(newEnd.getTime());
  } finally {
    if (apptId) {
      await pool.query('DELETE FROM appointments WHERE id = $1', [apptId]);
    }
    if (shiftId) {
      await pool.query('DELETE FROM employee_schedule WHERE id = $1', [shiftId]);
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 4. CREATE CUSTOMER — POST /customers + verify appears in dashboard list
// ────────────────────────────────────────────────────────────────────────────
test('create customer: API insert renders in CRM list and is queryable', async ({ page }) => {
  // WHO: tenant owner | WHAT: insert customer via API, verify dashboard list refresh
  // WHERE: POST /customers/create → CRMView list
  // WHY: end-to-end auth + RLS + list-refresh proof; UI form is exercised by component tests
  const tag = uniqueTag();
  const customerName = `E2E Test ${tag}`;
  const phone = `+1555${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`;
  let customerId: string | null = null;

  try {
    await page.goto('/dashboard');
    await switchToDynaTireTenant(page);
    const token = await getApiToken(page, 'admin@dynatire.com', 'password');

    const created = await page.evaluate(async ({ token, name, phone, tenantId }) => {
      const res = await fetch('https://localhost:4001/customers/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId, name, phone }),
      });
      return { status: res.status, body: await res.json() };
    }, { token, name: customerName, phone, tenantId: DYNATIRE_ID });
    expect(created.status, `expected 200 from /customers/create, got ${JSON.stringify(created)}`).toBe(200);
    customerId = created.body?.customer?.id ?? created.body?.id ?? null;
    expect(customerId, 'expected returned customer id').toBeTruthy();

    // Navigate to Customers view, refresh, and assert our row shows
    await page.getByRole('tab', { name: /^Customers$/ }).first().click();
    await page.waitForTimeout(1000);
    await page.reload(); // force list re-fetch
    await switchToDynaTireTenant(page);
    await page.getByRole('tab', { name: /^Customers$/ }).first().click();
    await expect(page.locator(`text=${customerName}`).first()).toBeVisible({ timeout: 10000 });

    // DB verification
    const db = await pool.query(
      `SELECT phone FROM customers WHERE id = $1 AND tenant_id = $2`,
      [customerId, DYNATIRE_ID],
    );
    expect(db.rowCount).toBe(1);
    expect(db.rows[0].phone).toBe(phone);
  } finally {
    if (customerId) {
      await pool.query('DELETE FROM customers WHERE id = $1', [customerId]);
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 5. FRONT-DESK ROLE GATING — only Primary tabs; restricted URL bounces home
// ────────────────────────────────────────────────────────────────────────────
test('front-desk role: cannot see Advanced tabs; stale URL redirects to Home', async ({ page }) => {
  // WHO: front_desk user | WHAT: log in, see only Primary tabs, navigate to ?tab=my-business
  // WHERE: OutlookLayout role gate + useEffect snap-back
  // WHY: regression-guard the role-based hiding from commit 8683222
  const tag = uniqueTag();
  const fdEmail = `e2e-fd-${tag}@example.com`;
  let fdUserId: string | null = null;

  try {
    const inserted = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, 'front_desk') RETURNING id`,
      [DYNATIRE_ID, fdEmail, SEED_PASSWORD_HASH, `Front Desk ${tag}`],
    );
    fdUserId = inserted.rows[0].id;

    await loginAs(page, fdEmail, 'password');

    // Primary tabs visible
    await expect(page.getByRole('tab', { name: /^Home$/ }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Schedule$/ }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Customers$/ }).first()).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Calls$/ }).first()).toBeVisible();

    // Advanced tabs hidden
    await expect(page.getByRole('tab', { name: /Services & Resources/ })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /Staff & Shifts/ })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /AI & Knowledge/ })).toHaveCount(0);

    // Stale URL → snapped back to Home (the dashboard tab)
    await page.goto('/dashboard?tab=my-business');
    await page.waitForTimeout(1500);
    // After the snap-back, the URL should not contain my-business as the active tab.
    // We don't assert URL specifically because the OutlookLayout uses internal state;
    // instead, assert the my-business-only content is not rendered.
    await expect(page.locator('text=Service Catalog')).toHaveCount(0);
  } finally {
    if (fdUserId) {
      await pool.query('DELETE FROM users WHERE id = $1', [fdUserId]);
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 6. INVITE TEAMMATE — owner invites; user + password_resets row created
// ────────────────────────────────────────────────────────────────────────────
test('invite teammate: owner POST /users/invite creates user + reset token', async ({ page }) => {
  // WHO: tenant owner | WHAT: call /users/invite, expect user row + password_resets row
  // WHERE: POST /users/invite (requireOwner gate, DASHBOARD_URL fallback safe)
  // WHY: covers the owner-only invite flow from commit e65c833
  const tag = uniqueTag();
  const inviteEmail = `e2e-invite-${tag}@example.com`;
  let invitedId: string | null = null;

  try {
    await page.goto('/dashboard');
    const token = await getApiToken(page, 'admin@dynatire.com', 'password');

    const result = await page.evaluate(async ({ token, email, tenantId }) => {
      const res = await fetch('https://localhost:4001/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: tenantId, email, full_name: 'E2E Invitee', role: 'front_desk' }),
      });
      return { status: res.status, body: await res.json() };
    }, { token, email: inviteEmail, tenantId: DYNATIRE_ID });
    expect(result.status, `expected 201 from /users/invite, got ${JSON.stringify(result)}`).toBe(201);

    // Verify user row + password_resets row exist
    const userRow = await pool.query(
      `SELECT id, role, password_hash FROM users WHERE email = $1 AND tenant_id = $2`,
      [inviteEmail, DYNATIRE_ID],
    );
    expect(userRow.rowCount).toBe(1);
    expect(userRow.rows[0].role).toBe('front_desk');
    expect(userRow.rows[0].password_hash, 'placeholder hash should be present').toBeTruthy();
    invitedId = userRow.rows[0].id;

    const resetRow = await pool.query(
      `SELECT 1 FROM password_resets WHERE user_id = $1 AND expires_at > NOW()`,
      [invitedId],
    );
    expect(resetRow.rowCount, 'expected an unexpired password_resets row').toBeGreaterThanOrEqual(1);
  } finally {
    if (invitedId) {
      await pool.query('DELETE FROM password_resets WHERE user_id = $1', [invitedId]);
      await pool.query('DELETE FROM users WHERE id = $1', [invitedId]);
    }
  }
});
