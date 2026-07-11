/**
 * Tests for conflictLookup — the helper that surfaces WHICH appointment is
 * blocking a slot when a booking RPC returns "already booked". Without this
 * lookup the dashboard can only show the operator a string error; with it
 * the operator gets the existing customer / employee / time-range and can
 * decide what to do (pick another slot, ask existing customer to reschedule).
 *
 * Two surfaces under test:
 *   1. isOverlapError(message) — pattern-matches the RPC's "already booked"
 *      strings; gates whether we run the follow-up SELECT at all.
 *   2. findOverlappingAppointment(client, params) — runs the SELECT itself.
 *      Predicate must mirror the GiST exclusion constraints applied
 *      2026-05-08; if it diverges, the operator could see a "no conflict"
 *      response when the constraint would have blocked the booking — the
 *      worst kind of false negative.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';

import { findOverlappingAppointment, isOverlapError } from '../../src/services/conflictLookup';

const TENANT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const RESOURCE_ID = 'dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb';
const EMPLOYEE_ID = 'ffffffff-1111-4222-8333-444444444444';

interface MockQuery {
  text: string;
  params: unknown[];
}

function buildMockClient(rows: unknown[]): { client: PoolClient; queries: MockQuery[] } {
  const queries: MockQuery[] = [];
  const client = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params: params || [] });
      return { rows, rowCount: rows.length };
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
  return { client, queries };
}

describe('isOverlapError', () => {
  // WHO: route handler deciding whether to do the follow-up conflict SELECT
  // WHAT: case-insensitive match on "already booked"
  // WHERE: appointments.ts SAD branch + agentTools booking flows
  // WHY: the booking RPCs use exactly these strings; matching the wrong set
  //       would either skip the lookup on real overlaps (operator sees no
  //       conflict info) or run it on non-overlap errors (wasted query +
  //       confusing UX since the lookup would return null)

  it('HAPPY: matches "Resource already booked during this timeslot"', () => {
    expect(isOverlapError('Resource already booked during this timeslot')).toBe(true);
  });

  it('HAPPY: matches "Employee already booked"', () => {
    expect(isOverlapError('Employee already booked')).toBe(true);
  });

  it('HAPPY: matches "User already booked"', () => {
    // WHO: user-assigned (not employee) booking path; same RPC string
    expect(isOverlapError('User already booked')).toBe(true);
  });

  it('HAPPY: case-insensitive — "ALREADY BOOKED" still matches', () => {
    expect(isOverlapError('SOMETHING ALREADY BOOKED')).toBe(true);
  });

  it('SAD: non-overlap RPC errors do NOT match', () => {
    // WHY: these are the other failure modes the RPC reports — past time,
    //       skill mismatch, shift coverage. None of them have a conflicting
    //       appointment to surface, so isOverlapError must return false and
    //       the route skips the SELECT.
    expect(isOverlapError('Cannot book in the past')).toBe(false);
    expect(isOverlapError('Employee is not on shift during this time')).toBe(false);
    expect(isOverlapError('Employee does not have required skills for this service')).toBe(false);
    expect(isOverlapError('NO_SKILLED_EMPLOYEE')).toBe(false);
  });

  it('SAD: null / undefined / empty string return false', () => {
    expect(isOverlapError(null)).toBe(false);
    expect(isOverlapError(undefined)).toBe(false);
    expect(isOverlapError('')).toBe(false);
  });
});

describe('findOverlappingAppointment', () => {
  it('HAPPY: returns the single conflicting row', async () => {
    // WHO: dashboard request that hit a resource overlap
    // WHAT: helper SELECTs the conflicting appointment and returns its details
    // WHEN: route handler calls this after RPC returns "Resource already booked"
    // WHERE: src/services/conflictLookup.ts findOverlappingAppointment
    // WHY: the operator needs the customer / employee / time of the existing
    //       booking to make a decision (pick another time vs ask existing
    //       customer to reschedule)
    const { client, queries } = buildMockClient([
      {
        appointment_id: 'existing-1',
        start_time: '2026-05-10T14:00:00Z',
        end_time: '2026-05-10T14:30:00Z',
        customer_name: 'Alice',
        employee_name: 'Mike',
        resource_name: 'Bay 1',
        description: 'Tire rotation',
      },
    ]);

    const conflict = await findOverlappingAppointment(client, {
      tenantId: TENANT_ID,
      resourceId: RESOURCE_ID,
      employeeId: EMPLOYEE_ID,
      startTime: '2026-05-10T14:00:00Z',
      endTime: '2026-05-10T14:30:00Z',
    });

    expect(conflict).toEqual({
      appointment_id: 'existing-1',
      start_time: '2026-05-10T14:00:00Z',
      end_time: '2026-05-10T14:30:00Z',
      customer_name: 'Alice',
      employee_name: 'Mike',
      resource_name: 'Bay 1',
      description: 'Tire rotation',
    });
    expect(queries).toHaveLength(1);
    // Pin the predicate shape — if a refactor drops the half-open overlap
    // check or the soft-delete filter, this fails loudly.
    expect(queries[0].text).toMatch(/a\.start_time < \$4/);
    expect(queries[0].text).toMatch(/a\.end_time\s+> \$3/);
    expect(queries[0].text).toMatch(/a\.is_deleted IS NULL OR a\.is_deleted = false/);
    expect(queries[0].text).toMatch(/a\.status\s+= 'scheduled'/);
    expect(queries[0].params).toEqual([
      TENANT_ID,
      RESOURCE_ID,
      '2026-05-10T14:00:00Z',
      '2026-05-10T14:30:00Z',
      EMPLOYEE_ID,
    ]);
  });

  it('HAPPY: returns null when no conflict found', async () => {
    // WHO: defensive path — RPC said "already booked" but the conflicting row
    //       was canceled/deleted between the RPC's check and our follow-up
    // WHAT: helper returns null instead of throwing
    // WHY: dashboard then renders the plain string error without a modal —
    //       the operator sees "Resource already booked" and can retry without
    //       the UI claiming there's a conflict to view
    const { client } = buildMockClient([]);

    const conflict = await findOverlappingAppointment(client, {
      tenantId: TENANT_ID,
      resourceId: RESOURCE_ID,
      employeeId: EMPLOYEE_ID,
      startTime: '2026-05-10T14:00:00Z',
      endTime: '2026-05-10T14:30:00Z',
    });

    expect(conflict).toBeNull();
  });

  it('HAPPY: handles null employeeId — predicate falls to resource-only', async () => {
    // WHO: unassigned booking (employee_id NULL) hitting a resource overlap
    // WHAT: $5 (employeeId) is NULL; the OR branch short-circuits via $5::uuid IS NOT NULL
    //        so only the resource match contributes
    // WHY: book_appointment_atomic accepts null assignment_id — the conflict
    //       lookup must mirror that shape, not 500 on null employee
    const { client, queries } = buildMockClient([
      {
        appointment_id: 'res-only',
        start_time: '2026-05-10T14:00:00Z',
        end_time: '2026-05-10T14:30:00Z',
        customer_name: 'Bob',
        employee_name: null,
        resource_name: 'Bay 1',
        description: 'Anonymous booking',
      },
    ]);

    const conflict = await findOverlappingAppointment(client, {
      tenantId: TENANT_ID,
      resourceId: RESOURCE_ID,
      employeeId: null,
      startTime: '2026-05-10T14:00:00Z',
      endTime: '2026-05-10T14:30:00Z',
    });

    expect(conflict?.appointment_id).toBe('res-only');
    expect(queries[0].params[4]).toBeNull();
  });

  it('HAPPY: orders by start_time ASC and limits to 1', async () => {
    // WHY: deterministic answer — if multiple conflicts somehow exist (a bug
    //       elsewhere allowed it before the GiST constraints), surface the
    //       earliest one rather than a random row. Pin both ORDER BY and
    //       LIMIT in the SQL so a future refactor that drops either fails.
    const { client, queries } = buildMockClient([{ appointment_id: 'first' }]);

    await findOverlappingAppointment(client, {
      tenantId: TENANT_ID,
      resourceId: RESOURCE_ID,
      employeeId: EMPLOYEE_ID,
      startTime: '2026-05-10T14:00:00Z',
      endTime: '2026-05-10T14:30:00Z',
    });

    expect(queries[0].text).toMatch(/ORDER BY a\.start_time ASC/);
    expect(queries[0].text).toMatch(/LIMIT 1/);
  });

  it('HAPPY: SELECT joins customer + employee + resource via LEFT JOIN', async () => {
    // WHY: LEFT (not INNER) — an appointment with NULL employee_id or with a
    //       soft-deleted customer should still surface its other details
    //       (resource_name, time range) so the operator isn't shown a blank
    //       conflict block. INNER JOIN would silently drop the row.
    const { client, queries } = buildMockClient([{ appointment_id: 'x' }]);

    await findOverlappingAppointment(client, {
      tenantId: TENANT_ID,
      resourceId: RESOURCE_ID,
      employeeId: EMPLOYEE_ID,
      startTime: '2026-05-10T14:00:00Z',
      endTime: '2026-05-10T14:30:00Z',
    });

    expect(queries[0].text).toMatch(/LEFT JOIN customers/);
    expect(queries[0].text).toMatch(/LEFT JOIN employees/);
    expect(queries[0].text).toMatch(/LEFT JOIN resources/);
  });
});

describe('findOverlappingAppointment — four overlap geometries', () => {
  // WHY: the half-open overlap predicate `a.start_time < requestedEnd AND
  //      a.end_time > requestedStart` covers all four geometries by
  //      construction, but the test names + per-case rows document each
  //      shape so a future predicate change that drops one is obvious.
  //      Mirrors the GiST exclusion constraints applied 2026-05-08.
  // Requested slot in every case: 14:00 → 14:30.

  const REQUEST_START = '2026-05-10T14:00:00Z';
  const REQUEST_END = '2026-05-10T14:30:00Z';

  it('GEOMETRY 1 — start-overlap: existing appt starts before request, ends inside', async () => {
    // existing 13:45 → 14:15 — overlaps the front edge of the request.
    const { client, queries } = buildMockClient([
      {
        appointment_id: 'start-overlap',
        start_time: '2026-05-10T13:45:00Z',
        end_time: '2026-05-10T14:15:00Z',
        customer_name: 'Alice',
        employee_name: 'Mike',
        resource_name: 'Bay 1',
        description: null,
      },
    ]);

    const conflict = await findOverlappingAppointment(client, {
      tenantId: TENANT_ID,
      resourceId: RESOURCE_ID,
      employeeId: EMPLOYEE_ID,
      startTime: REQUEST_START,
      endTime: REQUEST_END,
    });

    expect(conflict?.appointment_id).toBe('start-overlap');
    // Pin: $3 = requested start, $4 = requested end (predicate uses both)
    expect(queries[0].params[2]).toBe(REQUEST_START);
    expect(queries[0].params[3]).toBe(REQUEST_END);
  });

  it('GEOMETRY 2 — end-overlap: existing appt starts inside request, ends after', async () => {
    // existing 14:15 → 14:45 — overlaps the back edge of the request.
    const { client } = buildMockClient([
      {
        appointment_id: 'end-overlap',
        start_time: '2026-05-10T14:15:00Z',
        end_time: '2026-05-10T14:45:00Z',
        customer_name: 'Bob',
        employee_name: 'Mike',
        resource_name: 'Bay 1',
        description: null,
      },
    ]);

    const conflict = await findOverlappingAppointment(client, {
      tenantId: TENANT_ID,
      resourceId: RESOURCE_ID,
      employeeId: EMPLOYEE_ID,
      startTime: REQUEST_START,
      endTime: REQUEST_END,
    });

    expect(conflict?.appointment_id).toBe('end-overlap');
  });

  it('GEOMETRY 3 — contained: existing appt fully inside request', async () => {
    // existing 14:05 → 14:25 — entirely inside the requested 14:00→14:30.
    // Half-open overlap returns true: 14:05 < 14:30 AND 14:25 > 14:00.
    const { client } = buildMockClient([
      {
        appointment_id: 'contained',
        start_time: '2026-05-10T14:05:00Z',
        end_time: '2026-05-10T14:25:00Z',
        customer_name: 'Carol',
        employee_name: 'Mike',
        resource_name: 'Bay 1',
        description: null,
      },
    ]);

    const conflict = await findOverlappingAppointment(client, {
      tenantId: TENANT_ID,
      resourceId: RESOURCE_ID,
      employeeId: EMPLOYEE_ID,
      startTime: REQUEST_START,
      endTime: REQUEST_END,
    });

    expect(conflict?.appointment_id).toBe('contained');
  });

  it('GEOMETRY 4 — containing: existing appt fully covers request', async () => {
    // existing 13:30 → 15:00 — fully envelops the requested 14:00→14:30.
    // Half-open overlap returns true: 13:30 < 14:30 AND 15:00 > 14:00.
    const { client } = buildMockClient([
      {
        appointment_id: 'containing',
        start_time: '2026-05-10T13:30:00Z',
        end_time: '2026-05-10T15:00:00Z',
        customer_name: 'Dave',
        employee_name: 'Mike',
        resource_name: 'Bay 1',
        description: null,
      },
    ]);

    const conflict = await findOverlappingAppointment(client, {
      tenantId: TENANT_ID,
      resourceId: RESOURCE_ID,
      employeeId: EMPLOYEE_ID,
      startTime: REQUEST_START,
      endTime: REQUEST_END,
    });

    expect(conflict?.appointment_id).toBe('containing');
  });
});

describe('findOverlappingAppointment — flavor: resource vs employee', () => {
  // WHY: the GiST exclusion constraints applied 2026-05-08 enforce two
  //      separate overlap rules — one keyed on resource, one on employee.
  //      The lookup's WHERE-OR mirrors that: it must find a conflict caused
  //      by EITHER axis, regardless of which axis the requesting booking
  //      happens to share. These tests pin both axes activate independently.

  it('FLAVOR — resource conflict: existing appt blocks the same bay', async () => {
    // WHO: requesting booking shares resource_id with existing; different employee
    // WHAT: lookup must return the resource-conflict row even though employees differ
    const { client, queries } = buildMockClient([
      {
        appointment_id: 'res-conflict',
        start_time: '2026-05-10T14:00:00Z',
        end_time: '2026-05-10T14:30:00Z',
        customer_name: 'Alice',
        employee_name: 'OtherEmp',
        resource_name: 'Bay 1',
        description: null,
      },
    ]);

    const conflict = await findOverlappingAppointment(client, {
      tenantId: TENANT_ID,
      resourceId: RESOURCE_ID,
      employeeId: EMPLOYEE_ID,
      startTime: '2026-05-10T14:00:00Z',
      endTime: '2026-05-10T14:30:00Z',
    });

    expect(conflict?.appointment_id).toBe('res-conflict');
    expect(conflict?.resource_name).toBe('Bay 1');
    // The OR clause in the predicate must still fire on resource match
    // even when employees differ — pin its presence.
    expect(queries[0].text).toMatch(/a\.resource_id = \$2/);
  });

  it('FLAVOR — employee conflict: existing appt blocks the same employee on a different bay', async () => {
    // WHO: requesting booking shares employee_id with existing; different resource
    // WHAT: lookup's OR branch on employee_id activates and returns the row
    // WHY: employee can only be in one place at a time — the GiST exclusion
    //       on employee_id catches this even when resources differ. The
    //       lookup must mirror that or the conflict modal would say "no
    //       conflict found" while the constraint blocked the booking.
    const { client, queries } = buildMockClient([
      {
        appointment_id: 'emp-conflict',
        start_time: '2026-05-10T14:00:00Z',
        end_time: '2026-05-10T14:30:00Z',
        customer_name: 'Alice',
        employee_name: 'Mike',
        resource_name: 'Bay 2',
        description: null,
      },
    ]);

    const conflict = await findOverlappingAppointment(client, {
      tenantId: TENANT_ID,
      resourceId: RESOURCE_ID,
      employeeId: EMPLOYEE_ID,
      startTime: '2026-05-10T14:00:00Z',
      endTime: '2026-05-10T14:30:00Z',
    });

    expect(conflict?.appointment_id).toBe('emp-conflict');
    expect(conflict?.employee_name).toBe('Mike');
    // Pin the employee branch + the IS NOT NULL guard so a future
    // refactor that drops either fails this test loudly.
    expect(queries[0].text).toMatch(/\$5::uuid IS NOT NULL AND a\.employee_id = \$5::uuid/);
  });
});
