/**
 * Route-handler tests for src/routes/appointments.ts.
 *
 * Why this file exists:
 *   Pre-coverage baseline: 5.83% lines on the booking core. The underlying
 *   `book_appointment_atomic` RPC is exhaustively tested in
 *   `scheduling-atomic.test.ts` and `skill-resource-matching-sweep.test.ts`,
 *   but the Fastify route handler glue (Zod parsing, super-admin tenant
 *   widening, transactional update branch, cross-tenant 403 gate, fire-and-
 *   forget syncAppointmentToAll dispatch) had no direct coverage. A regression
 *   in the handler — say, dropping the cross-tenant check or swapping the
 *   wrong RPC — would slip past current tests.
 *
 * Phase 2.1 of the route-handler coverage push (docs/TODO.md). Built on the
 * `buildRouteTestApp()` helper proven in `src/routes/mappings.test.ts`.
 *
 * Coverage targets (each route, happy + at least one sad):
 *   - POST /appointments/create — Zod fail / RPC success / RPC failure / RPC empty
 *   - GET  /appointments        — tenant-scoped / super-admin / date-range / no-tenant
 *   - DELETE /appointments/:id  — happy / 404
 *   - POST /appointments/:id/cancel — happy / 404
 *   - POST /appointments/:id/update — happy minimal / happy with customer info /
 *     Zod fail / cross-tenant 403
 *
 * What this file does NOT cover:
 *   - DB-layer atomicity / RLS (covered by scheduling-atomic.test.ts /
 *     booking-concurrency.test.ts / rls.test.ts against real Postgres).
 *   - Full sync-fan-out behavior (covered by services/syncOrchestrator
 *     tests; here we only assert that it's invoked with the right args).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Mock the sync orchestrator so the fire-and-forget calls inside route
// handlers don't try to talk to real CRMs/calendars during tests. We assert
// against the mock to confirm wiring without exercising the orchestrator.
vi.mock('../services/syncOrchestrator', () => ({
    syncAppointmentToAll: vi.fn(),
}));

import { registerAppointmentRoutes } from './appointments';
import { syncAppointmentToAll } from '../services/syncOrchestrator';
import {
    buildRouteTestApp,
    type RouteTestAppHandle,
} from '../test-utils-mock';
import { SUPER_ADMIN_TENANT_ID } from '../constants';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_TENANT_ID = 'eeeeeeee-ffff-4aaa-8bbb-cccccccccccc';
const APPOINTMENT_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const CUSTOMER_ID = 'cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa';
const RESOURCE_ID = 'dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb';
const EMPLOYEE_ID = 'ffffffff-1111-4222-8333-444444444444';

let handle: RouteTestAppHandle;
let app: FastifyInstance;

beforeAll(async () => {
    handle = buildRouteTestApp((app, pool, withTenantClient) => {
        registerAppointmentRoutes(app, pool, withTenantClient);
    });
    app = handle.app;
    await app.ready();
});

afterAll(async () => {
    await app.close();
});

beforeEach(() => {
    handle.queries.length = 0;
    handle.queryResponses.length = 0;
    handle.tenantIdOverride.current = null;
    handle.auth.current = {
        user_id: '00000000-0000-0000-0000-000000000001',
        tenant_id: TENANT_ID,
        email: 'owner@test.local',
        role: 'owner',
    };
    vi.clearAllMocks();
});

const validCreatePayload = {
    tenant_id: TENANT_ID,
    resource_id: RESOURCE_ID,
    customer_id: CUSTOMER_ID,
    start_time: '2026-04-15T14:00:00Z',
    end_time: '2026-04-15T15:00:00Z',
    description: 'Brake replacement',
    location: 'Bay 1',
};

// ────────────────────────────────────────────────────────────────────
// POST /appointments/create
// ────────────────────────────────────────────────────────────────────

describe('POST /appointments/create', () => {
    it('HAPPY: calls book_appointment_atomic, returns appointment_id, fires sync', async () => {
        // WHO: tenant owner creating an appointment from the dashboard
        // WHAT: route delegates to book_appointment_atomic RPC; on success
        //       returns appointment_id and dispatches sync to all CRMs/calendars
        // WHEN: POST /appointments/create with valid Zod-shaped body
        // WHERE: src/routes/appointments.ts → app.post('/appointments/create', ...)
        // WHY: this is the manual-entry path (call_id='manual-entry'); the agent
        //       uses book_with_scheduling_atomic instead. Both must remain
        //       distinct so manual entries don't accidentally trigger the agent's
        //       skill-matching scan.
        handle.queryResponses.push({ rows: [{ success: true, appointment_id: APPOINTMENT_ID, error_message: null }] });

        const res = await app.inject({
            method: 'POST',
            url: '/appointments/create',
            payload: validCreatePayload,
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, appointment_id: APPOINTMENT_ID });

        const dataQueries = handle.queries.filter(
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        expect(dataQueries[0].text).toContain('book_appointment_atomic');
        expect(dataQueries[0].params[0]).toBe(TENANT_ID);
        expect(dataQueries[0].params[6]).toBe('manual-entry');
        expect(syncAppointmentToAll).toHaveBeenCalledWith(
            handle.mockPool,
            TENANT_ID,
            APPOINTMENT_ID,
            'create',
            expect.anything(),
        );
    });

    it('SAD: rejects absurd 23-hour appointments before hitting the RPC', async () => {
        const res = await app.inject({
            method: 'POST',
            url: '/appointments/create',
            payload: {
                ...validCreatePayload,
                end_time: '2026-04-16T13:00:00Z',
            },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({
            success: false,
            error: 'Appointment duration cannot exceed 12 hours',
        });
        const dataQueries = handle.queries.filter(
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        expect(dataQueries).toHaveLength(0);
        expect(syncAppointmentToAll).not.toHaveBeenCalled();
    });

    it('SAD: returns 400 on Zod validation failure (missing required field)', async () => {
        // WHO: a buggy client that omitted required body fields
        // WHAT: AppointmentCreateSchema.safeParse fails → 400 with details
        // WHEN: any POST with malformed body
        // WHERE: AppointmentCreateSchema check at top of handler
        // WHY: schema validation must fire BEFORE the booking RPC — a malformed
        //       request reaching the RPC could fail with an opaque Postgres
        //       type-cast error (500); the Zod gate gives a clean 400 with
        //       per-field details the dashboard can render
        const res = await app.inject({
            method: 'POST',
            url: '/appointments/create',
            payload: { tenant_id: 'not-uuid' }, // missing everything else too
        });

        expect(res.statusCode).toBe(400);
        const body = res.json();
        expect(body.success).toBe(false);
        expect(body.error).toBe('Validation failed');
        expect(Array.isArray(body.details)).toBe(true);

        // No DB query should have fired — Zod gate ran first
        const dataQueries = handle.queries.filter(
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        expect(dataQueries).toHaveLength(0);
        expect(syncAppointmentToAll).not.toHaveBeenCalled();
    });

    it('SAD: non-overlap RPC failures pass through with 400 + plain error (no conflict lookup)', async () => {
        // WHO: dashboard user trying to book a slot that fails an RPC constraint
        //       OTHER THAN overlap — e.g. past time, no skilled employee, off-shift
        // WHAT: route forwards the RPC's `error_message` verbatim with status 400
        //        and skips the conflict-lookup query (nothing to point at)
        // WHEN: book_appointment_atomic returns `{ success: false, error_message }`
        //        with a non-"already booked" message
        // WHERE: appointments.ts isOverlapError(...) gate
        // WHY: the RPC's diagnostic messages for non-overlap failures are useful
        //       on their own ("Employee is not on shift during this time"); a
        //       conflict block would be misleading because there's no conflicting
        //       appointment to display. Also: skipping the lookup saves a DB
        //       round-trip on every non-overlap rejection.
        handle.queryResponses.push({
            rows: [{ success: false, appointment_id: null, error_message: 'Employee is not on shift during this time' }],
        });

        const res = await app.inject({
            method: 'POST',
            url: '/appointments/create',
            payload: validCreatePayload,
        });

        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({
            success: false,
            error: 'Employee is not on shift during this time',
        });
        // Critical: only 1 RPC query, no follow-up conflict lookup.
        const dataQueries = handle.queries.filter(
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        expect(dataQueries).toHaveLength(1);
        expect(dataQueries[0].text).toContain('book_appointment_atomic');
        expect(syncAppointmentToAll).not.toHaveBeenCalled();
    });

    it('SAD: overlap rejection returns 409 + conflict block with existing appointment details', async () => {
        // WHO: front-desk operator trying to double-book a resource/employee
        // WHAT: RPC returns "Resource already booked"; route runs the follow-up
        //        SELECT to find the conflicting row and surfaces its details
        //        (id, customer name, employee name, resource name, time range)
        //        so the operator can decide what to do. Status flips to 409.
        // WHEN: any /appointments/create where the GiST exclusion constraint or
        //        the RPC's pre-check rejects on time-overlap
        // WHERE: appointments.ts isOverlapError + findOverlappingAppointment
        // WHY: a string error alone ("Resource already booked") gives the
        //       operator no actionable info. Showing "Bay 1 is taken by Alice
        //       with Mike from 2:00-2:30 (Tire rotation)" lets them pick another
        //       time, ask Alice to reschedule, or look up Alice's record.
        handle.queryResponses.push(
            { rows: [{ success: false, appointment_id: null, error_message: 'Resource already booked during this timeslot' }] },
            {
                rows: [{
                    appointment_id: 'existing-id',
                    start_time: '2026-05-10T14:00:00.000Z',
                    end_time: '2026-05-10T14:30:00.000Z',
                    customer_name: 'Alice',
                    employee_name: 'Mike',
                    resource_name: 'Bay 1',
                    description: 'Tire rotation',
                }],
            },
        );

        const res = await app.inject({
            method: 'POST',
            url: '/appointments/create',
            payload: validCreatePayload,
        });

        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({
            success: false,
            error: 'Resource already booked during this timeslot',
            error_code: 'TIMESLOT_OCCUPIED',
            conflict: {
                appointment_id: 'existing-id',
                start_time: '2026-05-10T14:00:00.000Z',
                end_time: '2026-05-10T14:30:00.000Z',
                customer_name: 'Alice',
                employee_name: 'Mike',
                resource_name: 'Bay 1',
                description: 'Tire rotation',
            },
        });
        expect(syncAppointmentToAll).not.toHaveBeenCalled();
        // Two data queries: the RPC + the conflict lookup. Pin shape so a
        // refactor that re-orders or drops the lookup fails this test.
        const dataQueries = handle.queries.filter(
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        expect(dataQueries).toHaveLength(2);
        expect(dataQueries[0].text).toContain('book_appointment_atomic');
        expect(dataQueries[1].text).toMatch(/SELECT[\s\S]*FROM appointments/i);
    });

    it('SAD: overlap rejection but conflict lookup empty returns 400 + plain error (defensive)', async () => {
        // WHO: extreme-edge race — RPC said "already booked" but by the time
        //        the follow-up SELECT runs, the conflicting row was canceled
        //        or soft-deleted (millisecond window between snapshot reads)
        // WHAT: route falls back to the plain 400 + error_message shape — no
        //        bogus conflict block claiming details we don't actually have
        // WHY: the dashboard's conflict modal would show empty fields if the
        //       backend returned a partial conflict object; null lets the UI
        //       branch on "no conflict to display" and just toast the message
        handle.queryResponses.push(
            { rows: [{ success: false, appointment_id: null, error_message: 'Employee already booked' }] },
            { rows: [] }, // conflict lookup finds nothing
        );

        const res = await app.inject({
            method: 'POST',
            url: '/appointments/create',
            payload: validCreatePayload,
        });

        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({
            success: false,
            error: 'Employee already booked',
        });
        expect(res.json().conflict).toBeUndefined();
        expect(syncAppointmentToAll).not.toHaveBeenCalled();
    });

    it('SAD: returns 500 when RPC returns no rows (DB-layer anomaly)', async () => {
        // WHO: a request hitting an unexpected DB state (RPC dropped/recreated
        //       mid-query, transaction snapshot anomaly)
        // WHAT: handler defends against `res.rows[0]` being undefined → 500
        // WHEN: book_appointment_atomic returns an empty result set
        // WHERE: `if (!result)` branch
        // WHY: without this guard, accessing `result.success` would throw a
        //       TypeError surfacing as 500 with a stack trace. The explicit
        //       guard returns a clean message the operator can search logs for.
        handle.queryResponses.push({ rows: [] });

        const res = await app.inject({
            method: 'POST',
            url: '/appointments/create',
            payload: validCreatePayload,
        });

        expect(res.statusCode).toBe(500);
        expect(res.json()).toEqual({
            success: false,
            error: 'Booking RPC returned no result',
        });
    });

    it('HAPPY: passes employee_id stringified when provided', async () => {
        // WHO: dashboard creating an appointment with an explicit employee assignment
        // WHAT: route stringifies employee_id (which may arrive as number or
        //       string) before passing to the RPC's TEXT param
        // WHEN: POST with employee_id present
        // WHERE: `body.employee_id ? body.employee_id.toString() : null`
        // WHY: book_appointment_atomic's p_assignment_id is TEXT (because it
        //       handles both employee UUIDs and user UUIDs); the route must
        //       coerce to string regardless of input type
        handle.queryResponses.push({ rows: [{ success: true, appointment_id: APPOINTMENT_ID, error_message: null }] });

        await app.inject({
            method: 'POST',
            url: '/appointments/create',
            payload: { ...validCreatePayload, employee_id: EMPLOYEE_ID },
        });

        const dataQueries = handle.queries.filter(
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        // employee_id is the 9th param (index 8)
        expect(dataQueries[0].params[8]).toBe(EMPLOYEE_ID);
    });
});

// ────────────────────────────────────────────────────────────────────
// GET /appointments
// ────────────────────────────────────────────────────────────────────

describe('GET /appointments', () => {
    it('HAPPY: tenant user gets appointments scoped to their tenant', async () => {
        // WHO: tenant owner viewing the appointment list
        // WHAT: SELECT joins customer + resource info, scoped by tenant_id
        // WHEN: GET /appointments without query params
        // WHERE: appointments.ts non-super-admin path (line ~127)
        // WHY: the WHERE includes a.tenant_id = $1 filter for non-admin callers;
        //       missing this filter would expose other tenants' appointments
        handle.queryResponses.push({ rows: [{ id: APPOINTMENT_ID, customer_id: CUSTOMER_ID }] });

        const res = await app.inject({ method: 'GET', url: '/appointments' });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(Array.isArray(body)).toBe(true);
        expect(body[0].id).toBe(APPOINTMENT_ID);

        const dataQueries = handle.queries.filter(
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        expect(dataQueries[0].text).toContain('FROM appointments');
        expect(dataQueries[0].text).toContain('a.tenant_id = $1');
        expect(dataQueries[0].params[0]).toBe(TENANT_ID);
    });

    it('HAPPY: super-admin gets cross-tenant appointments (no tenant filter)', async () => {
        // WHO: platform super-admin viewing all appointments across tenants
        // WHAT: route widens the query — drops the a.tenant_id = $N filter
        // WHEN: caller's tenant_id matches SUPER_ADMIN_TENANT_ID
        // WHERE: `if (!isSuperAdmin)` branch in appointments.ts (line ~83)
        // WHY: the super-admin dashboard needs cross-tenant visibility for
        //       support; this is the one route where dropping tenant scoping
        //       is intentional, gated on the well-known super-admin tenant ID
        handle.auth.current = {
            user_id: '00000000-0000-0000-0000-000000000001',
            tenant_id: SUPER_ADMIN_TENANT_ID,
            email: 'admin@platform',
            role: 'owner',
        };
        handle.queryResponses.push({ rows: [{ id: APPOINTMENT_ID }] });

        const res = await app.inject({ method: 'GET', url: '/appointments' });

        expect(res.statusCode).toBe(200);
        const dataQueries = handle.queries.filter(
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        // No tenant filter — query starts WHERE a.is_deleted = false then jumps to LIMIT
        expect(dataQueries[0].text).not.toContain('a.tenant_id = $');
        // Super-admin path goes through withPoolClient (pool.connect), not withTenantClient
        // The mock pool delegates pool.query to mockClient.query so we still capture it.
    });

    it('HAPPY: applies start_date and end_date filters when provided', async () => {
        // WHO: dashboard scheduler view filtering by visible date range
        // WHAT: query string adds two extra parameters bound into the WHERE clause
        // WHEN: GET /appointments?start_date=...&end_date=...
        // WHERE: dynamic `conditions` + `params` array build
        // WHY: scheduler view loads only the visible week; without these filters
        //       the API would return every historical appointment and the UI
        //       would have to filter client-side (slow + unbounded payload)
        handle.queryResponses.push({ rows: [] });

        await app.inject({
            method: 'GET',
            url: '/appointments?start_date=2026-04-15&end_date=2026-04-22',
        });

        const dataQueries = handle.queries.filter(
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        expect(dataQueries[0].text).toContain('a.start_time >=');
        expect(dataQueries[0].text).toContain('a.start_time <');
        expect(dataQueries[0].params).toContain('2026-04-15');
        expect(dataQueries[0].params).toContain('2026-04-22');
    });

    it('SAD: returns 400 when no tenant context is on the request', async () => {
        // WHO: a request that bypassed auth + tenantMiddleware
        // WHAT: requireTenantId() short-circuits with 400
        // WHEN: missing auth + missing tenantId override
        // WHERE: `if (!tenantId) return;`
        // WHY: every appointment query depends on tenant context (or super-admin
        //       widening); a missing context is a malformed request
        handle.auth.current = null;
        handle.tenantIdOverride.current = null;

        const res = await app.inject({ method: 'GET', url: '/appointments' });

        expect(res.statusCode).toBe(400);
        const dataQueries = handle.queries.filter(
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        expect(dataQueries).toHaveLength(0);
    });
});

// ────────────────────────────────────────────────────────────────────
// DELETE /appointments/:id
// ────────────────────────────────────────────────────────────────────

describe('DELETE /appointments/:id', () => {
    it('HAPPY: hard-deletes the row, fires sync, returns success', async () => {
        // WHO: tenant owner deleting an appointment
        // WHAT: DELETE FROM appointments WHERE id AND tenant_id, also fires
        //       sync('delete') BEFORE the DELETE so external systems see the
        //       cancellation
        // WHEN: DELETE /appointments/:id
        // WHERE: appointments.ts delete handler
        // WHY: sync-before-delete is intentional — if sync fires after the
        //       row is gone, the orchestrator can't read the row to know
        //       which external IDs to cancel
        handle.queryResponses.push({ rows: [{ id: APPOINTMENT_ID }] });

        const res = await app.inject({
            method: 'DELETE',
            url: `/appointments/${APPOINTMENT_ID}`,
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true });
        const dataQueries = handle.queries.filter(
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        expect(dataQueries[0].text).toContain('DELETE FROM appointments');
        expect(dataQueries[0].text).toContain('AND tenant_id = $2');
        expect(dataQueries[0].params).toEqual([APPOINTMENT_ID, TENANT_ID]);
        expect(syncAppointmentToAll).toHaveBeenCalledWith(
            handle.mockPool,
            TENANT_ID,
            APPOINTMENT_ID,
            'delete',
            expect.anything(),
        );
    });

    it('SAD: returns 404 when the row does not exist or is in a different tenant', async () => {
        // WHO: a stale dashboard view, or a cross-tenant delete attempt that
        //       was scoped correctly by the WHERE clause
        // WHAT: assertRowAffected sees rowCount=0 → 404
        // WHEN: DELETE for a non-existent id (or one in another tenant)
        // WHERE: assertRowAffected guard
        // WHY: BUG fixed in a prior sweep — without the row-count check, the
        //       handler returned `{ success: true }` even when nothing was
        //       deleted, masking cross-tenant access attempts
        handle.queryResponses.push({ rows: [], rowCount: 0 });

        const res = await app.inject({
            method: 'DELETE',
            url: `/appointments/${APPOINTMENT_ID}`,
        });

        expect(res.statusCode).toBe(404);
        expect(res.json()).toMatchObject({ success: false });
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /appointments/:id/cancel
// ────────────────────────────────────────────────────────────────────

describe('POST /appointments/:id/cancel', () => {
    it('HAPPY: sets status=canceled, fires delete-sync, returns success', async () => {
        // WHO: tenant cancelling an appointment without removing the audit row
        // WHAT: UPDATE appointments SET status = 'canceled' (soft cancel)
        //       then sync('delete') because canceled appointments shouldn't
        //       block the slot in external calendars/CRMs
        // WHEN: POST /appointments/:id/cancel
        // WHERE: cancel handler
        // WHY: distinct from DELETE because it preserves the row (audit /
        //       customer history); but external systems should treat it
        //       like a delete since the slot is now free
        handle.queryResponses.push({ rows: [{ id: APPOINTMENT_ID }] });

        const res = await app.inject({
            method: 'POST',
            url: `/appointments/${APPOINTMENT_ID}/cancel`,
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true });
        const dataQueries = handle.queries.filter(
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        expect(dataQueries[0].text).toContain("status = 'canceled'");
        expect(dataQueries[0].text).toContain('AND tenant_id = $2');
        expect(syncAppointmentToAll).toHaveBeenCalledWith(
            handle.mockPool,
            TENANT_ID,
            APPOINTMENT_ID,
            'delete', // not 'update' or 'cancel' — external systems see it as removal
            expect.anything(),
        );
    });

    it('SAD: returns 404 when no row matches', async () => {
        // WHO: cancel attempt on a missing/cross-tenant id
        // WHAT: rows.length === 0 → 404 explicit response (not assertRowAffected)
        // WHEN: UPDATE matches no rows
        // WHERE: `if (res.rows.length === 0)` branch
        // WHY: the cancel handler uses RETURNING id rather than rowCount; if
        //       the WHERE clause matched nothing the rows array is empty
        handle.queryResponses.push({ rows: [] });

        const res = await app.inject({
            method: 'POST',
            url: `/appointments/${APPOINTMENT_ID}/cancel`,
        });

        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ success: false, error: 'Appointment not found' });
        expect(syncAppointmentToAll).not.toHaveBeenCalled();
    });
});

// ────────────────────────────────────────────────────────────────────
// POST /appointments/:id/update
// ────────────────────────────────────────────────────────────────────

describe('POST /appointments/:id/update', () => {
    it('HAPPY: updates appointment fields in a transaction, fires sync', async () => {
        // WHO: tenant rescheduling an appointment
        // WHAT: BEGIN → UPDATE appointments SET ... → COMMIT, then sync('update')
        // WHEN: POST /:id/update with one or more updatable fields
        // WHERE: update handler transaction block
        // WHY: the transaction wraps both the appointment update AND the
        //       optional customer-info update so they commit atomically;
        //       a partial failure rolls back both
        // BEGIN, SELECT existing appointment, UPDATE appointments, COMMIT — 4 scripted responses
        handle.queryResponses.push({ rows: [] }); // BEGIN
        handle.queryResponses.push({ rows: [{ start_time: '2026-04-15T15:00:00Z', end_time: '2026-04-15T16:00:00Z' }] }); // SELECT existing
        handle.queryResponses.push({ rows: [] }); // UPDATE appointments
        handle.queryResponses.push({ rows: [] }); // COMMIT

        const res = await app.inject({
            method: 'POST',
            url: `/appointments/${APPOINTMENT_ID}/update`,
            payload: {
                tenant_id: TENANT_ID,
                start_time: '2026-04-15T15:00:00Z',
                end_time: '2026-04-15T16:00:00Z',
                description: 'Rescheduled brake replacement',
            },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true });
        const dataQueries = handle.queries.filter(
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        expect(dataQueries[0].text).toBe('BEGIN');
        expect(dataQueries[1].text).toContain('SELECT start_time::text AS start_time');
        expect(dataQueries[2].text).toContain('UPDATE appointments SET');
        expect(dataQueries[2].text).toContain('start_time =');
        expect(dataQueries[2].text).toContain('description =');
        expect(dataQueries[3].text).toBe('COMMIT');
        expect(syncAppointmentToAll).toHaveBeenCalledWith(
            handle.mockPool,
            TENANT_ID,
            APPOINTMENT_ID,
            'update',
            expect.anything(),
        );
    });

    it('HAPPY: updates customer info when customer_name/phone/notes provided', async () => {
        // WHO: tenant updating customer details from the appointment detail panel
        // WHAT: in addition to UPDATE appointments, the handler does a SELECT
        //       customer_id then UPDATE customers (atomically in the same txn)
        // WHEN: payload includes customer_name / customer_phone / customer_notes
        // WHERE: customer-info update branch (line ~217)
        // WHY: the customer detail edit lives on the appointment view for UX
        //       reasons; the route accepts both kinds of edits in one call
        //       so the dashboard doesn't need two round-trips
        handle.queryResponses.push({ rows: [] }); // BEGIN
        handle.queryResponses.push({ rows: [] }); // UPDATE appointments (no fields → 0 statements actually) — wait, the description does count
        handle.queryResponses.push({ rows: [{ customer_id: CUSTOMER_ID }] }); // SELECT customer_id
        handle.queryResponses.push({ rows: [] }); // UPDATE customers
        handle.queryResponses.push({ rows: [] }); // COMMIT

        const res = await app.inject({
            method: 'POST',
            url: `/appointments/${APPOINTMENT_ID}/update`,
            payload: {
                tenant_id: TENANT_ID,
                description: 'Updated note',
                customer_name: 'New Name',
                customer_phone: '+15559999999',
            },
        });

        expect(res.statusCode).toBe(200);
        const dataQueries = handle.queries.filter(
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        // Should see SELECT customer_id and UPDATE customers in addition to UPDATE appointments
        const customerUpdateQueries = dataQueries.filter((q) => q.text.includes('UPDATE customers'));
        expect(customerUpdateQueries).toHaveLength(1);
        expect(customerUpdateQueries[0].text).toContain('name =');
        expect(customerUpdateQueries[0].text).toContain('phone =');
    });

    it('SAD: returns 400 on Zod validation failure', async () => {
        // WHO: client sending malformed update payload (e.g., bad UUID)
        // WHAT: AppointmentUpdateSchema.safeParse fails → 400 with details
        // WHEN: POST /:id/update with bad body
        // WHERE: schema check at top of handler
        // WHY: same defense-first pattern as create — keep malformed data
        //       out of Postgres
        const res = await app.inject({
            method: 'POST',
            url: `/appointments/${APPOINTMENT_ID}/update`,
            payload: { tenant_id: 'not-uuid' },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe('Validation failed');
        expect(syncAppointmentToAll).not.toHaveBeenCalled();
    });

    it('SAD: returns 403 when body.tenant_id does not match auth tenant (cross-tenant attempt)', async () => {
        // WHO: an authenticated user trying to update another tenant's appointment
        //       by passing a different tenant_id in the body
        // WHAT: cross-tenant guard — body.tenant_id must match req.auth.tenant_id
        //       unless the caller is super-admin
        // WHEN: payload.tenant_id !== auth.tenant_id (and not super-admin)
        // WHERE: cross-tenant gate (line ~182)
        // WHY: closes the same class of cross-tenant injection that
        //       multi-tenant-isolation.test.ts catches — defense-in-depth
        //       inside the handler in addition to the middleware-layer gate
        const res = await app.inject({
            method: 'POST',
            url: `/appointments/${APPOINTMENT_ID}/update`,
            payload: {
                tenant_id: OTHER_TENANT_ID, // different from auth's tenant_id
                description: 'malicious update attempt',
            },
        });

        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({
            success: false,
            error: 'tenant_id does not match authenticated tenant',
        });
        expect(syncAppointmentToAll).not.toHaveBeenCalled();
        // No DB query should have fired
        const dataQueries = handle.queries.filter(
            (q) => !q.text.startsWith('SET LOCAL') && !q.text.startsWith('RESET'),
        );
        expect(dataQueries).toHaveLength(0);
    });

    it('SAD: rejects absurd 23-hour updates before the write', async () => {
        handle.queryResponses.push({ rows: [] }); // BEGIN
        handle.queryResponses.push({ rows: [{ start_time: '2026-04-15T10:00:00Z', end_time: '2026-04-15T11:00:00Z' }] });
        handle.queryResponses.push({ rows: [] }); // ROLLBACK

        const res = await app.inject({
            method: 'POST',
            url: `/appointments/${APPOINTMENT_ID}/update`,
            payload: {
                tenant_id: TENANT_ID,
                start_time: '2026-04-15T10:00:00Z',
                end_time: '2026-04-16T09:00:00Z',
                description: 'Way too long',
            },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({
            success: false,
            error: 'Appointment duration cannot exceed 12 hours',
        });
        expect(syncAppointmentToAll).not.toHaveBeenCalled();
    });

    it('HAPPY: super-admin can update any tenant\'s appointment (cross-tenant gate exempted)', async () => {
        // WHO: platform super-admin doing support-driven update
        // WHAT: cross-tenant gate is bypassed when auth.tenant_id is the super-admin
        //       sentinel — body.tenant_id can target any tenant
        // WHEN: super-admin caller, body.tenant_id is some other tenant
        // WHERE: cross-tenant gate `authTenantId !== SUPER_ADMIN_TENANT_ID` clause
        // WHY: support workflow needs cross-tenant write access; without this
        //       carve-out, super-admins couldn't fix customer issues
        handle.auth.current = {
            user_id: '00000000-0000-0000-0000-000000000001',
            tenant_id: SUPER_ADMIN_TENANT_ID,
            email: 'admin@platform',
            role: 'owner',
        };
        handle.queryResponses.push({ rows: [] }); // BEGIN
        handle.queryResponses.push({ rows: [] }); // UPDATE appointments
        handle.queryResponses.push({ rows: [] }); // COMMIT

        const res = await app.inject({
            method: 'POST',
            url: `/appointments/${APPOINTMENT_ID}/update`,
            payload: {
                tenant_id: OTHER_TENANT_ID, // different from super-admin's tenant
                description: 'Support update',
            },
        });

        expect(res.statusCode).toBe(200);
        expect(syncAppointmentToAll).toHaveBeenCalledWith(
            handle.mockPool,
            OTHER_TENANT_ID, // sync targets the body tenant, not the caller's tenant
            APPOINTMENT_ID,
            'update',
            expect.anything(),
        );
    });
});
