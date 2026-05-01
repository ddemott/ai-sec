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
    // WHAT: helper returns inserted: 0, no INSERTs sent. Returns a
    //      degenerate date range (rangeStart === rangeEnd) so the
    //      caller can still log a result without null-checking.
    // WHERE: src/services/expandWeeklyToSchedule.ts early-return after
    //      the SELECT comes back empty.
    // WHEN: any time expandWeeklyToSchedule is invoked for an employee
    //      with no employee_shifts rows — wizard finalize, manual
    //      re-runs, future scheduled fan-out jobs.
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
    // WHO: route handler that omitted weeks_ahead in the body, or any
    //      direct caller that wants the canonical onboarding window.
    // WHAT: helper uses 4 as the default window — produces 4 weekly
    //      occurrences of a single-day pattern over 28 days.
    // WHERE: src/services/expandWeeklyToSchedule.ts:38 default param.
    // WHEN: every call where the params object omits weeksAhead.
    // WHY: explicit default prevents callers from accidentally passing
    //      undefined and getting NaN-day windows. 4 weeks was chosen
    //      to give owners a month of bookable coverage out of the box.
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
    // WHERE: every INSERT inside the per-day loop in expandWeeklyToSchedule.
    // WHEN: any expand-weekly call after the owner has touched the
    //      Front Desk scheduler — i.e., almost every re-run after
    //      first onboarding.
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
    // WHO: any tenant whose employees have a mix of active and
    //      inactive weekly shift rows (toggled days, soft-removed days).
    // WHAT: the read query must scope to the right tenant + employee
    //       (RLS-belt-and-suspenders) AND skip is_active = false rows
    //       so toggled-off days don't get re-fanned.
    // WHERE: the SELECT in expandWeeklyToSchedule before the per-day
    //       loop runs — if the filter is wrong here every downstream
    //       insert is wrong too.
    // WHEN: every call — this guard is on the hot path.
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

  it('6a. honors a non-Monday startDate without off-by-one bugs', async () => {
    // WHO: caller invoking expand-weekly mid-week (the wizard fires
    //      whenever the owner finishes setup — could be any weekday).
    // WHAT: starting on a Wednesday (DOW=3) with a Mon+Wed pattern,
    //       the first 7 days should produce 1 Wed and 1 Mon (the
    //       upcoming Mon of the next week, NOT a missing Mon before
    //       the start). 14-day window with weeksAhead=2: 2 Wed + 2 Mon.
    // WHERE: the date generation loop in expandWeeklyToSchedule.
    // WHEN: any caller that doesn't anchor on a Monday — most real
    //      onboarding sessions.
    // WHY: a regression that anchors weeks to Mondays (e.g., shifting
    //      startDate back to the previous Monday) would either skip
    //      the partial first week or double-count it.
    // 2026-04-29 is a Wednesday.
    const wedAndMonPattern = [
      { day_of_week: 1, start_time: '09:00:00', end_time: '17:00:00' }, // Mon
      { day_of_week: 3, start_time: '09:00:00', end_time: '17:00:00' }, // Wed
    ];
    const { client, inserts } = buildClient(wedAndMonPattern);

    const wed = new Date('2026-04-29T00:00:00.000Z');
    const result = await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      weeksAhead: 2,
      startDate: wed,
    });

    // 14 days from Wed Apr 29 → Tue May 12. Mons in window: May 4, May 11. Weds: Apr 29, May 6.
    expect(result.inserted).toBe(4);
    expect(result.rangeStart).toBe('2026-04-29');
    expect(result.rangeEnd).toBe('2026-05-12');

    const dates = inserts.map((i) => i.params[2] as string).sort();
    expect(dates).toEqual(['2026-04-29', '2026-05-04', '2026-05-06', '2026-05-11']);
  });

  it('6b. accepts weeksAhead=1 (smallest valid window)', async () => {
    // WHO: a caller that wants minimal coverage — e.g., a future
    //      "extend by one week" button on the dashboard.
    // WHAT: weeksAhead=1 produces exactly 7 days of dates, NOT 8 or
    //       6 (off-by-one in the loop bound would skew either side).
    // WHERE: the for-loop bound (i < dayCount) inside
    //      expandWeeklyToSchedule.
    // WHEN: any minimum-window invocation.
    // WHY: boundary tests catch edge-case loop math bugs that uniform
    //      4-week tests can hide.
    const everyDayPattern = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
      day_of_week: dow,
      start_time: '09:00:00',
      end_time: '17:00:00',
    }));
    const { client, inserts } = buildClient(everyDayPattern);

    const result = await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      weeksAhead: 1,
      startDate: MONDAY_2026_04_27,
    });

    expect(result.inserted).toBe(7);
    expect(inserts).toHaveLength(7);
    expect(result.rangeStart).toBe('2026-04-27');
    expect(result.rangeEnd).toBe('2026-05-03');
  });

  it('6c. is defensive against duplicate day_of_week rows in the pattern', async () => {
    // WHO: defensive against a future bug elsewhere — e.g., a wizard
    //      step that accidentally double-inserts a weekly row, or a
    //      data import that lands two Monday entries.
    // WHAT: the patternByDow Map keeps only the LAST seen row per
    //      day_of_week. The fan-out should produce exactly one
    //      INSERT per matching date, not one per duplicate row.
    // WHERE: the patternByDow Map.set() calls in the helper.
    // WHEN: rare, but the data shape technically allows duplicates
    //      (no UNIQUE constraint on (employee_id, day_of_week)).
    // WHY: without this guard, a single duplicate weekly row would
    //      double-insert per matching date — and ON CONFLICT would
    //      mask the second one as "0 rowCount", quietly hiding the bug.
    const dupMonPattern = [
      { day_of_week: 1, start_time: '09:00:00', end_time: '17:00:00' },
      { day_of_week: 1, start_time: '10:00:00', end_time: '18:00:00' }, // dup
    ];
    const { client, inserts } = buildClient(dupMonPattern);

    await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      weeksAhead: 1,
      startDate: MONDAY_2026_04_27,
    });

    // 1 Monday in 7 days from a Monday → exactly 1 INSERT, not 2.
    expect(inserts).toHaveLength(1);
    // The "last write wins" rule should pick the second pattern row.
    expect(inserts[0].params[3]).toBe('10:00:00');
    expect(inserts[0].params[4]).toBe('18:00:00');
  });

  it('6. each INSERT carries the exact start/end_time from the matching pattern', async () => {
    // WHO: any owner whose pattern uses different hours per day
    //      (e.g., short Tuesday, long Thursday) — common for part-time.
    // WHAT: the pattern for Tuesday is 10-14; every Tuesday in the
    //       window must INSERT with those exact times, not the wrong
    //       day's times via off-by-one indexing.
    // WHERE: the per-day INSERT inside the date-iteration loop —
    //       specifically params[3] (start) and params[4] (end).
    // WHEN: every INSERT — but a bug here only shows under varying
    //       per-day hours, which is why uniform 9-5 patterns can hide it.
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
    // WHO: any caller — wizard, future cron, ad-hoc admin tool.
    // WHAT: caller hits an unexpected DB failure (RLS context not set,
    //      connection drop, FK violation). Helper must reject; calling
    //      code's withHandler converts the rejection into a 500.
    // WHERE: the SELECT throws first; even if it succeeded the per-row
    //      INSERTs are equally subject to this guard.
    // WHEN: any DB-level fault — rare but real (deploys, replica
    //      failover, rare statement_timeout hit).
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
