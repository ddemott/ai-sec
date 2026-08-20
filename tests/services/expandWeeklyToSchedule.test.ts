/**
 * Tests for expandWeeklyToSchedule — the fan-out helper that turns a
 * caller-supplied weekly pattern into date-specific employee_schedule
 * rows. The wizard collects the pattern in form state and passes it
 * here directly; there is no separate weekly-pattern table.
 *
 * Strategy: mock PoolClient.query, drive day-of-week math with a
 * fixed startDate, verify the SQL parameter shapes the helper sends.
 *
 * NOTE ON THE TWO BUCKETS: since 2026-08-20 the helper ALSO writes the declared
 * weekly rule to `employee_schedule_pattern` (so the schedule extender projects
 * a stated rule instead of guessing one back out of the rows). The mock sorts
 * queries by target table so `inserts` keeps meaning what it always meant — the
 * employee_schedule fan-out — and the rule statements are asserted separately.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';
import { expandWeeklyToSchedule } from '../../src/services/expandWeeklyToSchedule';

const TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const EMPLOYEE_ID = '11111111-2222-3333-8444-555555555555';

interface MockQuery {
  text: string;
  params: unknown[];
  /** Parsed (date, start, end) tuples from the multi-row VALUES list.
      Computed from params so tests can assert on the per-row data
      without depending on the SQL string format. */
  tuples: { tenantId: string; employeeId: string; date: string; start: string; end: string }[];
}

/**
 * Helper builds a mock pg client that:
 *   1. Records every query for assertion.
 *   2. Parses the multi-row INSERT's params into per-tuple records.
 *   3. Returns rowCount = number of tuples (mirrors what Postgres
 *      would return for a multi-row INSERT with ON CONFLICT DO NOTHING
 *      when no rows conflict — every supplied row was inserted).
 *
 * Why parse the params instead of asserting on call count: the helper
 * was rewritten 2026-05-18 to issue ONE multi-row INSERT instead of N
 * single-row INSERTs (eliminates a deadlock window under concurrent
 * cascade-DELETE). Tests now pin the CONTRACT (correct rows for the
 * pattern × date matrix) not the IMPLEMENTATION (call count).
 */
function buildClient(): {
  client: PoolClient;
  inserts: MockQuery[];
  ruleQueries: MockQuery[];
} {
  const inserts: MockQuery[] = [];
  const ruleQueries: MockQuery[] = [];

  const client = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      const p = params ?? [];
      // The multi-row INSERT shape is (tenant_id, employee_id, date,
      // start, end, false) per tuple → 5 placeholders in params per
      // row (the literal `false` doesn't use a placeholder).
      const tuples: MockQuery['tuples'] = [];
      for (let i = 0; i < p.length; i += 5) {
        tuples.push({
          tenantId: p[i] as string,
          employeeId: p[i + 1] as string,
          date: p[i + 2] as string,
          start: p[i + 3] as string,
          end: p[i + 4] as string,
        });
      }
      // The weekly RULE goes to its own table and its own bucket — otherwise
      // every assertion about the fan-out would be counting three statements.
      (text.includes('employee_schedule_pattern') ? ruleQueries : inserts).push({
        text,
        params: p,
        tuples,
      });
      // rowCount = number of rows inserted (mirrors Postgres semantics
      // for multi-row INSERT — caller filters via ON CONFLICT for real
      // conflict cases; mock has no conflicts so all rows count).
      return { rows: [], rowCount: tuples.length };
    }),
    release: vi.fn(),
  } as unknown as PoolClient;

  return { client, inserts, ruleQueries };
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
    // WHAT: helper iterates 28 days (4 weeks × 7) and inserts a row
    //       whenever the date's day-of-week matches one of the supplied
    //       pattern entries. 5 days/week × 4 weeks = 20 inserts.
    // WHERE: src/services/expandWeeklyToSchedule.ts.
    // WHEN: invoked from POST /shifts/expand-weekly at wizard finalize.
    // WHY: without this, booking RPCs return EMPLOYEE_NOT_SCHEDULED
    //      for every date — onboarding completes silently broken.
    const monFriPattern = [1, 2, 3, 4, 5].map((dow) => ({
      day_of_week: dow,
      start_time: '09:00:00',
      end_time: '17:00:00',
    }));
    const { client, inserts } = buildClient();

    const result = await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      pattern: monFriPattern,
      weeksAhead: 4,
      startDate: MONDAY_2026_04_27,
    });

    expect(result.inserted).toBe(20);
    // One multi-row INSERT carrying 20 tuples (was: 20 single-row
    // INSERTs pre-2026-05-18).
    expect(inserts).toHaveLength(1);
    expect(inserts[0].tuples).toHaveLength(20);
    expect(result.rangeStart).toBe('2026-04-27');
    // 28 days from a Monday → Sunday 4 weeks later = May 24
    expect(result.rangeEnd).toBe('2026-05-24');
  });

  it('2. no-ops cleanly when pattern is empty', async () => {
    // WHO: caller invoking the wizard endpoint for an employee whose
    //      hours the owner never set (form-state empty at finalize).
    // WHAT: helper returns inserted: 0, no INSERTs sent.
    // WHERE: src/services/expandWeeklyToSchedule.ts early-return.
    // WHEN: any time expandWeeklyToSchedule is invoked with an empty
    //       pattern — wizard finalize for an unconfigured employee,
    //       manual re-runs after deletion.
    // WHY: the wizard may finalize before all employees have hours
    //      configured; treating "no pattern" as a no-op keeps the
    //      finalize path simple (no error branch to handle).
    const { client, inserts } = buildClient();

    const result = await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      pattern: [],
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
    //       occurrences of a single-day pattern over 28 days.
    // WHERE: src/services/expandWeeklyToSchedule.ts default param.
    // WHEN: every call where the params object omits weeksAhead.
    // WHY: explicit default prevents callers from accidentally passing
    //      undefined and getting NaN-day windows. 4 weeks was chosen
    //      to give owners a month of bookable coverage out of the box.
    const oneDayPattern = [{ day_of_week: 1, start_time: '08:00:00', end_time: '16:00:00' }];
    const { client } = buildClient();

    const result = await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      pattern: oneDayPattern,
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
    const { client, inserts } = buildClient();

    await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      pattern: monPattern,
      weeksAhead: 2,
      startDate: MONDAY_2026_04_27,
    });

    expect(inserts.length).toBeGreaterThan(0);
    for (const ins of inserts) {
      expect(ins.text).toMatch(/ON CONFLICT.*DO NOTHING/i);
    }
    // Multi-row INSERT must carry every matching date as a tuple.
    expect(inserts[0].tuples.length).toBeGreaterThan(0);
  });

  it('5. honors a non-Monday startDate without off-by-one bugs', async () => {
    // WHO: caller invoking expand-weekly mid-week (the wizard fires
    //      whenever the owner finishes setup — could be any weekday).
    // WHAT: starting on a Wednesday (DOW=3) with a Mon+Wed pattern,
    //       the first 7 days should produce 1 Wed and 1 Mon (the
    //       upcoming Mon of the next week, NOT a missing Mon before
    //       the start). 14-day window with weeksAhead=2: 2 Wed + 2 Mon.
    // WHERE: the date generation loop in expandWeeklyToSchedule.
    // WHEN: any caller that doesn't anchor on a Monday — most real
    //      onboarding sessions.
    // WHY: a regression that anchors weeks to Mondays would either
    //      skip the partial first week or double-count it.
    // 2026-04-29 is a Wednesday.
    const wedAndMonPattern = [
      { day_of_week: 1, start_time: '09:00:00', end_time: '17:00:00' }, // Mon
      { day_of_week: 3, start_time: '09:00:00', end_time: '17:00:00' }, // Wed
    ];
    const { client, inserts } = buildClient();

    const wed = new Date('2026-04-29T00:00:00.000Z');
    const result = await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      pattern: wedAndMonPattern,
      weeksAhead: 2,
      startDate: wed,
    });

    // 14 days from Wed Apr 29 → Tue May 12. Mons in window: May 4, May 11. Weds: Apr 29, May 6.
    expect(result.inserted).toBe(4);
    expect(result.rangeStart).toBe('2026-04-29');
    expect(result.rangeEnd).toBe('2026-05-12');

    // Single multi-row INSERT — pull dates from its tuples.
    expect(inserts).toHaveLength(1);
    const dates = inserts[0].tuples.map((t) => t.date).sort();
    expect(dates).toEqual(['2026-04-29', '2026-05-04', '2026-05-06', '2026-05-11']);
  });

  it('6. accepts weeksAhead=1 (smallest valid window)', async () => {
    // WHO: a caller that wants minimal coverage — e.g., a future
    //      "extend by one week" button on the dashboard.
    // WHAT: weeksAhead=1 produces exactly 7 days of dates, NOT 8 or
    //       6 (off-by-one in the loop bound would skew either side).
    // WHERE: the for-loop bound (i < dayCount) inside the helper.
    // WHEN: any minimum-window invocation.
    // WHY: boundary tests catch edge-case loop math bugs that uniform
    //      4-week tests can hide.
    const everyDayPattern = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
      day_of_week: dow,
      start_time: '09:00:00',
      end_time: '17:00:00',
    }));
    const { client, inserts } = buildClient();

    const result = await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      pattern: everyDayPattern,
      weeksAhead: 1,
      startDate: MONDAY_2026_04_27,
    });

    expect(result.inserted).toBe(7);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].tuples).toHaveLength(7);
    expect(result.rangeStart).toBe('2026-04-27');
    expect(result.rangeEnd).toBe('2026-05-03');
  });

  it('7. is defensive against duplicate day_of_week rows in the pattern', async () => {
    // WHO: defensive against a future bug elsewhere — e.g., a wizard
    //      step that accidentally double-inserts a weekly row, or a
    //      data import that lands two Monday entries.
    // WHAT: the patternByDow Map keeps only the LAST seen row per
    //      day_of_week. The fan-out should produce exactly one
    //      INSERT per matching date, not one per duplicate row.
    // WHERE: the patternByDow Map.set() calls in the helper.
    // WHEN: rare, but the data shape technically allows duplicates
    //      (pattern is an unconstrained array param).
    // WHY: without this guard, a single duplicate row would
    //      double-insert per matching date — and ON CONFLICT would
    //      mask the second one as "0 rowCount", quietly hiding the bug.
    const dupMonPattern = [
      { day_of_week: 1, start_time: '09:00:00', end_time: '17:00:00' },
      { day_of_week: 1, start_time: '10:00:00', end_time: '18:00:00' }, // dup
    ];
    const { client, inserts } = buildClient();

    await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      pattern: dupMonPattern,
      weeksAhead: 1,
      startDate: MONDAY_2026_04_27,
    });

    // 1 Monday in 7 days from a Monday → exactly 1 tuple, not 2.
    expect(inserts).toHaveLength(1);
    expect(inserts[0].tuples).toHaveLength(1);
    // The "last write wins" rule should pick the second pattern row.
    expect(inserts[0].tuples[0].start).toBe('10:00:00');
    expect(inserts[0].tuples[0].end).toBe('18:00:00');
  });

  it('8. each INSERT carries the exact start/end_time from the matching pattern', async () => {
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
    const tuePattern = [{ day_of_week: 2, start_time: '10:00:00', end_time: '14:00:00' }];
    const { client, inserts } = buildClient();

    await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      pattern: tuePattern,
      weeksAhead: 1,
      startDate: MONDAY_2026_04_27,
    });

    // Exactly one Tuesday in a week starting Monday — Apr 28.
    expect(inserts).toHaveLength(1);
    expect(inserts[0].tuples).toHaveLength(1);
    expect(inserts[0].tuples[0].date).toBe('2026-04-28');
    expect(inserts[0].tuples[0].start).toBe('10:00:00');
    expect(inserts[0].tuples[0].end).toBe('14:00:00');
  });
});

describe('expandWeeklyToSchedule — sad paths', () => {
  it('9. propagates DB errors instead of swallowing them', async () => {
    // WHO: any caller — wizard, future cron, ad-hoc admin tool.
    // WHAT: caller hits an unexpected DB failure (RLS context not set,
    //      connection drop, FK violation). Helper must reject; calling
    //      code's withHandler converts the rejection into a 500.
    // WHERE: any per-row INSERT — they're the only DB calls.
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
        pattern: [{ day_of_week: 1, start_time: '09:00:00', end_time: '17:00:00' }],
        startDate: MONDAY_2026_04_27,
      })
    ).rejects.toThrow(/connection terminated/);
  });
});

describe('expandWeeklyToSchedule — the declared weekly rule', () => {
  it('writes the rule BEFORE the dated rows, retiring weekdays not in the pattern', async () => {
    // WHO: an owner saving Mon/Wed/Fri hours in the wizard.
    // WHAT: a DELETE that retires every weekday NOT in this pattern, then an
    //       upsert of the three that are — and both land before the
    //       employee_schedule fan-out.
    // WHERE: src/services/expandWeeklyToSchedule.ts replaceWeeklyRule().
    // WHEN: every wizard finalize and every POST /shifts/expand-weekly.
    // WHY: the rule must be REPLACED, not merged. A weekday absent from the
    //      pattern means the owner dropped it; an upsert alone can only add or
    //      change a row, never retire one, so a dropped Wednesday would be
    //      projected forward by the extender forever. Ordering matters only for
    //      a partial failure: rule-then-rows leaves the extender able to
    //      project a stated rule, rows-then-rule leaves it guessing again.
    const { client, inserts, ruleQueries } = buildClient();

    await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      pattern: [
        { day_of_week: 1, start_time: '09:00:00', end_time: '17:00:00' },
        { day_of_week: 3, start_time: '09:00:00', end_time: '17:00:00' },
        { day_of_week: 5, start_time: '10:00:00', end_time: '14:00:00' },
      ],
      weeksAhead: 1,
      startDate: MONDAY_2026_04_27,
    });

    expect(ruleQueries).toHaveLength(2);

    const [del, upsert] = ruleQueries;
    expect(del.text).toContain('DELETE FROM employee_schedule_pattern');
    expect(del.text).toContain('day_of_week <> ALL');
    expect(del.params).toEqual([TENANT_ID, EMPLOYEE_ID, [1, 3, 5]]);

    expect(upsert.text).toContain('INSERT INTO employee_schedule_pattern');
    expect(upsert.text).toContain('ON CONFLICT (tenant_id, employee_id, day_of_week)');
    expect(upsert.params).toEqual([
      TENANT_ID,
      EMPLOYEE_ID,
      1,
      '09:00:00',
      '17:00:00',
      TENANT_ID,
      EMPLOYEE_ID,
      3,
      '09:00:00',
      '17:00:00',
      TENANT_ID,
      EMPLOYEE_ID,
      5,
      '10:00:00',
      '14:00:00',
    ]);

    // The fan-out still happens, and still as ONE multi-row INSERT.
    expect(inserts).toHaveLength(1);
  });

  it('sends NO rule statements when the pattern is empty', async () => {
    // WHY: an empty pattern is ambiguous — "this employee has no hours" and
    //      "the caller had nothing to send" arrive identically. Wiping a
    //      working rule on the ambiguous reading is how a bookable business
    //      goes dark; removing a rule is the wizard's explicit prune path.
    const { client, inserts, ruleQueries } = buildClient();

    const result = await expandWeeklyToSchedule(client, {
      tenantId: TENANT_ID,
      employeeId: EMPLOYEE_ID,
      pattern: [],
      weeksAhead: 4,
      startDate: MONDAY_2026_04_27,
    });

    expect(result.inserted).toBe(0);
    expect(ruleQueries).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });
});
