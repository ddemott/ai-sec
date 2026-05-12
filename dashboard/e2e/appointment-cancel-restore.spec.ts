/**
 * E2E coverage for the cancel + reactivate appointment lifecycle, shipped
 * 2026-05-10 against the new POST /appointments/:id/reactivate route.
 *
 * Why this exists: docs/TODO.md "Cancel + restore appointment" (P1) asked
 * for proof of the canceled-state UX — clicking a canceled appointment,
 * seeing canceled state, attempting to reactivate. Pre-2026-05-10 there
 * was no reactivate path at all; cancel was a one-way soft delete. This
 * spec pins the new route's three observable contracts:
 *
 *   1. HAPPY canceled→scheduled. Book, cancel, reactivate. DB row's status
 *      cycles cleanly back to 'scheduled' and external sync is told to
 *      re-add (sync('create') fires after the UPDATE commits — verifying
 *      that requires a recorder, which is overkill for a contract test;
 *      the unit test in src/routes/appointments.test.ts pins it).
 *
 *   2. SAD slot-rebooked race. The dangerous case: book A, cancel A
 *      (slot freed), book B in A's slot, then try to reactivate A. The
 *      GiST exclusion constraint must fire and the route must return
 *      409 + TIMESLOT_OCCUPIED + conflict block — without that, an
 *      operator could silently UNDO a re-booking by reactivating an
 *      old canceled row, double-booking the slot.
 *
 *   3. SAD already-scheduled. Reactivate on a row that's already
 *      'scheduled' returns 400 + NOT_CANCELED — guards against a stale
 *      UI clicking reactivate on a row another session already restored
 *      (or never canceled), which would otherwise fire a duplicate
 *      sync('create') and create duplicate calendar events.
 *
 * API-only design (matches calendar-sync.spec.ts + setup-wizard-to-booking
 * .spec.ts): the dashboard component-test in CustomerDetailPanel.test.tsx
 * pins the click-renders-button-with-correct-id contract; this spec pins
 * the BACKEND contract that affordance depends on. Keeps the e2e fast
 * (~1s/test) and avoids SSR/hydration flakes that have bitten other UI
 * specs.
 *
 * Each test owns its data lifecycle: fresh tenant via /register → seed
 * minimal entities → drive the scenario via direct HTTP → DELETE FROM
 * tenants in `finally` (cascade clears all dependent rows in one stmt).
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { Pool } from 'pg';
import {
  BACKEND_URL,
  PG_URL,
  registerFreshTenant,
  seedBookingScenario,
  seedAppointment,
  cleanTenantData,
  isoDateDaysFromNow,
  type RegisteredTenant,
} from './helpers/fixtures';

let pool: Pool;

async function cancelAppointmentAs(
  req: APIRequestContext,
  token: string,
  tenantId: string,
  appointmentId: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await req.post(`${BACKEND_URL}/appointments/${appointmentId}/cancel`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    data: { tenant_id: tenantId },
  });
  return { status: res.status(), body: await res.json() };
}

async function reactivateAppointmentAs(
  req: APIRequestContext,
  token: string,
  tenantId: string,
  appointmentId: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await req.post(`${BACKEND_URL}/appointments/${appointmentId}/reactivate`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    data: { tenant_id: tenantId },
  });
  return { status: res.status(), body: await res.json() };
}

async function getAppointmentStatus(
  tenantId: string,
  appointmentId: string
): Promise<string | null> {
  const r = await pool.query(
    `SELECT status FROM appointments WHERE appointment_id = $1 AND tenant_id = $2`,
    [appointmentId, tenantId]
  );
  return r.rows[0]?.status ?? null;
}

test.beforeAll(() => {
  pool = new Pool({ connectionString: PG_URL });
});
test.afterAll(async () => {
  await pool.end();
});

// ────────────────────────────────────────────────────────────────────────────
// 1. HAPPY: full canceled → scheduled lifecycle
// ────────────────────────────────────────────────────────────────────────────
test('reactivate-happy: cancel then reactivate cycles a row from scheduled→canceled→scheduled', async ({ request }) => {
  // WHO: front-desk operator restoring a canceled appointment from customer
  //       history (the only UI surface where canceled rows are reachable).
  // WHAT: POST /:id/cancel sets status='canceled' (slot freed); POST /:id/
  //        reactivate flips back to 'scheduled' (slot re-claimed). Both
  //        round-trips return 200 + success:true. DB row at the end has
  //        status='scheduled' — the soft-delete row never went anywhere
  //        (preserved for audit / customer history through the cycle).
  // WHEN: typical operational case where a customer changes their mind
  //        AFTER the appointment was canceled, and the slot is still free.
  // WHERE: /appointments/:id/cancel route (UPDATE status='canceled') +
  //        /appointments/:id/reactivate route (UPDATE status='scheduled').
  // WHY: the soft-cancel pattern's whole point is preserving the audit row
  //        for customer history — but pre-2026-05-10 there was no path back
  //        to 'scheduled' once canceled, so the audit was a one-way grave.
  //        This test pins the round-trip so a future "simplification" that
  //        hard-deletes canceled rows or makes cancel terminal would
  //        surface here.
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const date = isoDateDaysFromNow(14);
    const seed = await seedBookingScenario(request, pool, tenant.token, tenant.tenantId, {
      employees: ['Test Tech'],
      resources: ['Test Bay'],
      shiftDates: [date],
    });

    const startTime = `${date}T14:00:00.000Z`;
    const endTime = `${date}T14:30:00.000Z`;
    const apptId = await seedAppointment(pool, tenant.tenantId, {
      resourceId: seed.resourceIds[0],
      customerId: seed.customerId,
      employeeId: seed.employeeIds[0],
      startTime,
      endTime,
      description: 'oil change',
    });
    expect(await getAppointmentStatus(tenant.tenantId, apptId)).toBe('scheduled');

    // Cancel
    const cancelRes = await cancelAppointmentAs(request, tenant.token, tenant.tenantId, apptId);
    expect(cancelRes.status, `cancel must succeed; body=${JSON.stringify(cancelRes.body)}`).toBe(200);
    expect(cancelRes.body.success).toBe(true);
    expect(await getAppointmentStatus(tenant.tenantId, apptId)).toBe('canceled');

    // Reactivate
    const reactRes = await reactivateAppointmentAs(request, tenant.token, tenant.tenantId, apptId);
    expect(reactRes.status, `reactivate must succeed; body=${JSON.stringify(reactRes.body)}`).toBe(200);
    expect(reactRes.body.success).toBe(true);
    expect(await getAppointmentStatus(tenant.tenantId, apptId)).toBe('scheduled');
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 2. SAD: slot-rebooked race
// ────────────────────────────────────────────────────────────────────────────
test('reactivate-conflict: reactivating into a slot that was rebooked while canceled returns 409 with conflict block', async ({ request }) => {
  // WHO: operator who canceled appointment A, the slot got taken by
  //        appointment B, and now wants to undo the cancellation.
  // WHAT: appointment A is 14:00-14:30; cancel A; book B at the same
  //        14:00-14:30; reactivate A. The GiST exclusion constraint
  //        appointments_no_resource_overlap fires on the UPDATE because
  //        A flipping back to 'scheduled' would create two scheduled
  //        rows in the same resource+timeslot. The route catches PG
  //        23P01, runs findOverlappingAppointment, returns 409 +
  //        error_code='TIMESLOT_OCCUPIED' + conflict block describing B.
  //        Critically, A's status MUST stay 'canceled' — the UPDATE
  //        rolled back, the failure is the route's response, not a
  //        partial commit. B stays 'scheduled'.
  // WHEN: any reactivate where the slot was reused while canceled. This
  //        is the most operationally important sad path: silently
  //        succeeding (or worse, allowing both A and B to be 'scheduled')
  //        would let an operator double-book a slot just by reactivating
  //        an old canceled row.
  // WHERE: src/routes/appointments.ts /:id/reactivate handler — try/catch
  //        around the UPDATE, code === '23P01' branch.
  // WHY: pre-fix-pattern, the dashboard's "this slot is no longer
  //        available" UX depends on the conflict block populating a
  //        ConflictModal-shaped object. Without 409 + the block, the
  //        operator sees a generic error and has no way to know who
  //        rebooked the slot.
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const date = isoDateDaysFromNow(14);
    const seed = await seedBookingScenario(request, pool, tenant.token, tenant.tenantId, {
      employees: ['Test Tech'],
      resources: ['Test Bay'],
      shiftDates: [date],
    });

    const startTime = `${date}T14:00:00.000Z`;
    const endTime = `${date}T14:30:00.000Z`;

    // Appointment A — to be canceled and reactivated
    const apptA = await seedAppointment(pool, tenant.tenantId, {
      resourceId: seed.resourceIds[0],
      customerId: seed.customerId,
      employeeId: seed.employeeIds[0],
      startTime,
      endTime,
      description: 'A: original booking',
    });
    // Cancel A — frees the slot
    const cancelRes = await cancelAppointmentAs(request, tenant.token, tenant.tenantId, apptA);
    expect(cancelRes.status).toBe(200);
    expect(await getAppointmentStatus(tenant.tenantId, apptA)).toBe('canceled');

    // Appointment B — takes the freed slot
    const apptB = await seedAppointment(pool, tenant.tenantId, {
      resourceId: seed.resourceIds[0],
      customerId: seed.customerId,
      employeeId: seed.employeeIds[0],
      startTime,
      endTime,
      description: 'B: rebooked slot',
    });

    // Reactivate A — must fail with 409 + conflict block
    const reactRes = await reactivateAppointmentAs(request, tenant.token, tenant.tenantId, apptA);
    expect(reactRes.status, `expected 409; body=${JSON.stringify(reactRes.body)}`).toBe(409);
    expect(reactRes.body.success).toBe(false);
    expect(reactRes.body.error_code).toBe('TIMESLOT_OCCUPIED');
    const conflict = reactRes.body.conflict as Record<string, unknown> | undefined;
    expect(conflict, 'conflict block must surface the blocker').toBeTruthy();
    expect(conflict?.appointment_id).toBe(apptB);
    expect(conflict?.resource_name).toBe('Test Bay');
    expect(conflict?.employee_name).toBe('Test Tech');

    // State of truth: A still canceled, B still scheduled. No double-book.
    expect(await getAppointmentStatus(tenant.tenantId, apptA)).toBe('canceled');
    expect(await getAppointmentStatus(tenant.tenantId, apptB)).toBe('scheduled');
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 3. SAD: reactivate on a non-canceled row
// ────────────────────────────────────────────────────────────────────────────
test('reactivate-not-canceled: reactivating a scheduled row returns 400 NOT_CANCELED', async ({ request }) => {
  // WHO: a stale UI session — the operator clicked reactivate on a row
  //        another session (or another tab) already restored, OR clicked
  //        on a row that was never canceled in the first place.
  // WHAT: POST /:id/reactivate against status='scheduled' returns 400 +
  //        error_code='NOT_CANCELED'. No UPDATE issued, no sync fired.
  // WHEN: stale-UI flicker — the dashboard's customer-history rendered
  //        from a slightly-stale fetch and the user clicked before the
  //        next refresh.
  // WHERE: src/routes/appointments.ts /:id/reactivate handler — the
  //        outcome === 'not_canceled' branch after the SELECT.
  // WHY: without this guard, reactivating an already-scheduled row would
  //        silently UPDATE status='scheduled' (no-op write but still a
  //        write), then fire sync('create') a second time — duplicate
  //        calendar events on Google / Outlook / Jobber. The error_code
  //        also lets the dashboard distinguish from a 409 "slot taken"
  //        so it can surface "this appointment is already active" and
  //        refresh, vs the conflict modal.
  let tenant: RegisteredTenant | null = null;
  try {
    tenant = await registerFreshTenant(request);
    const date = isoDateDaysFromNow(14);
    const seed = await seedBookingScenario(request, pool, tenant.token, tenant.tenantId, {
      employees: ['Test Tech'],
      resources: ['Test Bay'],
      shiftDates: [date],
    });

    const apptId = await seedAppointment(pool, tenant.tenantId, {
      resourceId: seed.resourceIds[0],
      customerId: seed.customerId,
      employeeId: seed.employeeIds[0],
      startTime: `${date}T14:00:00.000Z`,
      endTime: `${date}T14:30:00.000Z`,
      description: 'never canceled',
    });

    const reactRes = await reactivateAppointmentAs(request, tenant.token, tenant.tenantId, apptId);
    expect(reactRes.status).toBe(400);
    expect(reactRes.body.success).toBe(false);
    expect(reactRes.body.error_code).toBe('NOT_CANCELED');

    // Status unchanged — the guard prevents the UPDATE.
    expect(await getAppointmentStatus(tenant.tenantId, apptId)).toBe('scheduled');
  } finally {
    if (tenant) await cleanTenantData(pool, tenant.tenantId);
  }
});
