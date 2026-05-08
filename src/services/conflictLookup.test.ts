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

import { findOverlappingAppointment, isOverlapError } from './conflictLookup';

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
