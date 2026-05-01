/**
 * Tests for expandWeeklyToSchedule — the fan-out helper that bridges
 * `employee_shifts` (weekly patterns the wizard writes) and
 * `employee_schedule` (date-specific rows the booking RPCs read).
 *
 * Pre-fix bug: owners who finished onboarding could not book —
 * booking RPCs read employee_schedule, which was empty. This helper
 * is what the wizard now calls at finalize to populate it.
 *
 * Strategy: mock PoolClient.query, drive day-of-week math with a
 * fixed startDate, verify the SQL parameter shapes the helper sends.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';
import { expandWeeklyToSchedule } from './expandWeeklyToSchedule';

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const EMPLOYEE_ID = '11111111-2222-3333-8444-555555555555';

interface MockQuery {
  text: string;
  params: unknown[];
}

function buildClient(weeklyRows: unknown[]): {
  client: PoolClient;
  queries: MockQuery[];
  inserts: MockQuery[];
} {
  const queries: MockQuery[] = [];
  const inserts: MockQuery[] = [];

  const client = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params: params ?? [] });
      if (text.startsWith('SELECT')) {
        return { rows: weeklyRows, rowCount: weeklyRows.length };
      }
      // INSERT
      inserts.push({ text, params: params ?? [] });
      // ON CONFLICT DO NOTHING — pretend each insert succeeds
      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(),
  } as unknown as PoolClient;

  return { client, queries, inserts };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Fixed Monday so day-of-week math is deterministic regardless of
// when this test happens to run. 2026-04-27 is a Monday (DOW = 1).
const MONDAY_2026_04_27 = new Date('2026-04-27T00:00:00.000Z');

describe('expandWeeklyToSchedule — happy paths', () => {
  it('1. inserts one row per matching weekday across the requested window', async () => {
    // WHO: solo owner who set Mon-Fri 9-5 in the wizard, finishes setup.
    // WHAT: helper reads the 5 weekly rows, then for each of 28 days
    //       (4 weeks × 7) inserts a row whenever the date's day-of-week
    //       matches one of the patterns. 5 days/week × 4 weeks = 20 inserts.
    // WHERE: src/services/expandWeeklyToSchedule.ts.
    // WHEN: invoked from POST /shifts/expand-weekly at wizard finalize.
    // WHY: without this, booking RPCs return EMPLOYEE_NOT_SCHEDULED
    //      for every date — onboarding completes silently broken.
    const monFriPattern = [1, 2, 3, 4, 5].map((dow) => ({
      day_of_week: dow,
      start_time: '09:00:00',
      end_time: '17:00:00',
    }));
    const { client, inserts } = buildClient(monFriPattern);

    const result = await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      weeksAhead: 4,
      startDate: MONDAY_2026_04_27,
    });

    expect(result.inserted).toBe(20);
    expect(inserts).toHaveLength(20);
    expect(result.rangeStart).toBe('2026-04-27');
    // 28 days from a Monday → Sunday 4 weeks later = May 24
    expect(result.rangeEnd).toBe('2026-05-24');
  });

  it('2. no-ops cleanly when employee has no weekly rows', async () => {
    // WHO: caller invoking the wizard endpoint for an employee whose
    //      shifts the owner never set (e.g., still in step 2 of wizard).
    // WHAT: helper returns inserted: 0 with a degenerate date range —
    //      neither errors nor inserts anything.
    // WHY: the wizard may finalize before all employees have hours
    //      configured; treating "no pattern" as a no-op keeps the
    //      finalize path simple (no error branch to handle).
    const { client, inserts } = buildClient([]);

    const result = await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      weeksAhead: 4,
      startDate: MONDAY_2026_04_27,
    });

    expect(result.inserted).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it('3. defaults weeksAhead to 4 when not provided', async () => {
    // WHAT: 4 weeks is the chosen default — gives owner a month of
    //      bookable coverage. Verify by counting the date span.
    // WHY: explicit default prevents callers from accidentally passing
    //      undefined and getting NaN-day windows.
    const oneDayPattern = [{ day_of_week: 1, start_time: '08:00:00', end_time: '16:00:00' }];
    const { client } = buildClient(oneDayPattern);

    const result = await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      startDate: MONDAY_2026_04_27,
      // weeksAhead omitted
    });

    // 4 Mondays in 28 days starting from a Monday: Apr 27, May 4, 11, 18
    expect(result.inserted).toBe(4);
  });

  it('4. uses ON CONFLICT DO NOTHING to preserve existing date-specific edits', async () => {
    // WHO: owner who already adjusted a specific date in the Front Desk
    //      scheduler (e.g., took May 4 off). They re-run wizard or
    //      something else triggers expand-weekly.
    // WHAT: every INSERT must include ON CONFLICT DO NOTHING so the
    //      May-4-off override isn't blown away by a re-fan.
    // WHERE: every INSERT inside the per-day loop.
    // WHY: a fan-out that overwrites date-specific edits would silently
    //      undo owner intent on already-configured dates.
    const monPattern = [{ day_of_week: 1, start_time: '09:00:00', end_time: '17:00:00' }];
    const { client, inserts } = buildClient(monPattern);

    await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      weeksAhead: 2,
      startDate: MONDAY_2026_04_27,
    });

    expect(inserts.length).toBeGreaterThan(0);
    for (const ins of inserts) {
      expect(ins.text).toMatch(/ON CONFLICT.*DO NOTHING/i);
    }
  });

  it('5. weekly SELECT filters by tenant + employee + active', async () => {
    // WHAT: the read query must scope to the right tenant + employee
    //       (RLS-belt-and-suspenders) AND skip is_active = false rows
    //       so toggled-off days don't get re-fanned.
    // WHY: if the SELECT didn't filter is_active, an owner who
    //      deliberately turned off a Saturday shift would see it
    //      reappear in the schedule next week.
    const { client, queries } = buildClient([]);

    await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      startDate: MONDAY_2026_04_27,
    });

    const selectQuery = queries.find((q) => q.text.startsWith('SELECT'));
    expect(selectQuery).toBeDefined();
    expect(selectQuery!.text).toContain('FROM employee_shifts');
    expect(selectQuery!.text).toContain('tenant_id = $1');
    expect(selectQuery!.text).toContain('employee_id = $2');
    expect(selectQuery!.text).toMatch(/is_active IS NULL OR is_active = true/);
    expect(selectQuery!.params).toEqual([TENANT_ID, EMPLOYEE_ID]);
  });

  it('6. each INSERT carries the exact start/end_time from the matching pattern', async () => {
    // WHAT: the pattern for Tuesday is 10-14; every Tuesday in the
    //       window must INSERT with those exact times, not the wrong
    //       day's times via off-by-one indexing.
    // WHY: a regression that shifted pattern->date assignment by one
    //      day would silently corrupt every owner's schedule.
    const tuePattern = [
      { day_of_week: 2, start_time: '10:00:00', end_time: '14:00:00' },
    ];
    const { client, inserts } = buildClient(tuePattern);

    await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      weeksAhead: 1,
      startDate: MONDAY_2026_04_27,
    });

    // Exactly one Tuesday in a week starting Monday — Apr 28.
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params[2]).toBe('2026-04-28');
    expect(inserts[0].params[3]).toBe('10:00:00');
    expect(inserts[0].params[4]).toBe('14:00:00');
  });
});

describe('expandWeeklyToSchedule — sad paths', () => {
  it('7. propagates DB errors instead of swallowing them', async () => {
    // WHAT: caller hits an unexpected DB failure (RLS context not set,
    //      connection drop, FK violation).
    // WHY: the wizard's finalize handler needs the error to surface so
    //      the user sees "Setup failed. Please try again." rather than
    //      a green checkmark that hides a half-broken state.
    const failingClient = {
      query: vi.fn().mockRejectedValue(new Error('connection terminated')),
      release: vi.fn(),
    } as unknown as PoolClient;

    await expect(
      expandWeeklyToSchedule(failingClient, {
        tenantId: TENANT_ID,
        employeeId: EMPLOYEE_ID,
        startDate: MONDAY_2026_04_27,
      })
    ).rejects.toThrow(/connection terminated/);
  });
});
