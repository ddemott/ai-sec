/**
 * Real-DB tests for the rolling schedule extender.
 *
 * WHY REAL POSTGRES: the whole thing is one SQL statement — a DISTINCT ON over a
 * tail window, a generate_series join on EXTRACT(DOW), and an ON CONFLICT against
 * a composite PK. A mock would assert that the string I wrote is the string I
 * wrote. Only the real planner can tell me it does what I think.
 *
 * 5W:
 *   WHO  — every tenant whose Setup-wizard schedule is running out
 *   WHAT — repeat each employee's final week forward to a rolling horizon
 *   WHEN — worker tick (daily) + once at boot
 *   WHERE— src/services/extendSchedules.ts
 *   WHY  — employee_schedule holds DATES, not a rule. The bookable window shrinks
 *          by a day every day. On 2026-07-12 a real caller asked for a normal
 *          Wednesday inside the owner's normal Mon–Fri 1–5 hours and was told
 *          "no one is scheduled that day" — because the rows simply stopped.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Client, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { extendSchedules } from '../../src/services/extendSchedules';

let setup: Client;
let pool: Pool;
let dbAvailable = false;
let tenantId: string;
let employeeId: string;
const tenantsToClean: string[] = [];

/** Declare a weekly RULE row directly (what the wizard now writes). */
async function seedRule(dow: number, start = '13:00', end = '17:00') {
  await setup.query(
    `INSERT INTO employee_schedule_pattern (tenant_id, employee_id, day_of_week, start_time, end_time)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, employee_id, day_of_week)
       DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
    [tenantId, employeeId, dow, start, end]
  );
}

/** Distinct weekdays present in employee_schedule, optionally bounded. */
async function scheduledDows(maxOffsetDays?: number): Promise<number[]> {
  const res = await setup.query<{ dow: number }>(
    `SELECT DISTINCT EXTRACT(DOW FROM shift_date)::int AS dow
       FROM employee_schedule
      WHERE tenant_id = $1
        AND ($2::int IS NULL OR shift_date <= CURRENT_DATE + $2::int)
      ORDER BY dow`,
    [tenantId, maxOffsetDays ?? null]
  );
  return res.rows.map((r) => r.dow);
}

/** Insert a shift row directly (bypassing the service under test). */
async function seedShift(date: string, start = '13:00', end = '17:00', isOff = false) {
  await setup.query(
    `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tenant_id, employee_id, shift_date) DO NOTHING`,
    [tenantId, employeeId, date, start, end, isOff]
  );
}

/**
 * Run the extender WITH tenant context — which is mandatory, not incidental.
 * `employees` has a tenant-isolation RLS policy and NO admin bypass, so a
 * context-free call sees zero employees and extends nothing. The first draft of
 * this service ran cross-tenant and silently inserted 0 rows; these tests are what
 * caught it.
 */
async function run(horizonDays = 90) {
  const withTenantClient = createWithTenantClient(pool);
  return withTenantClient(tenantId, (client) => extendSchedules(client, { horizonDays }));
}

async function shiftDates(): Promise<string[]> {
  const res = await setup.query<{ shift_date: Date }>(
    `SELECT shift_date FROM employee_schedule WHERE tenant_id = $1 ORDER BY shift_date`,
    [tenantId]
  );
  return res.rows.map((r) => r.shift_date.toISOString().slice(0, 10));
}

/** ISO date N days from today, in the DB's terms. */
async function dayOffset(n: number): Promise<string> {
  const res = await setup.query<{ d: Date }>(`SELECT (CURRENT_DATE + $1::int) AS d`, [n]);
  return res.rows[0].d.toISOString().slice(0, 10);
}

/** The next occurrence of a given DOW (0=Sun) on/after tomorrow. */
async function nextDow(dow: number): Promise<string> {
  const res = await setup.query<{ d: Date }>(
    `SELECT (CURRENT_DATE + 1
             + (($1::int - EXTRACT(DOW FROM CURRENT_DATE + 1)::int + 7) % 7)::int)::date AS d`,
    [dow]
  );
  return res.rows[0].d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });
    tenantId = await createTenant(setup, 'Schedule Extender Co', 'auto-shop');
    tenantsToClean.push(tenantId);
    const emp = await setup.query<{ employee_id: string }>(
      `INSERT INTO employees (tenant_id, name, is_active) VALUES ($1, 'Pat Tech', true)
       RETURNING employee_id`,
      [tenantId]
    );
    employeeId = emp.rows[0].employee_id;
    dbAvailable = true;
  } catch (err) {
    console.warn('[extendSchedules.realdb] DB not available, skipping', err);
  }
});

afterAll(async () => {
  if (pool) await pool.end();
  if (setup) {
    for (const id of tenantsToClean) {
      await setup.query('DELETE FROM tenants WHERE tenant_id = $1', [id]).catch(() => {});
    }
    await setup.end();
  }
});

beforeEach(async (ctx) => {
  skipIfDbDown(ctx, () => dbAvailable);
  if (!dbAvailable) return;
  await setup.query('DELETE FROM employee_schedule WHERE tenant_id = $1', [tenantId]);
  await setup.query('DELETE FROM employee_schedule_pattern WHERE tenant_id = $1', [tenantId]);
});

describe('extendSchedules (real DB)', () => {
  it('HAPPY: repeats the final week forward — the exact bug from the 2026-07-12 call', async () => {
    // WHO: Thinking Hammer. Mon–Fri 1–5, rows ending a week from now.
    // WHAT: a caller asks for a weekday BEYOND the last row. Before this service,
    //        no row existed → EMPLOYEE_NOT_SCHEDULED → "no one is scheduled."
    // WHY: reproduce it exactly — seed a Mon–Fri week, then assert the same
    //       weekday one week PAST the tail becomes bookable.
    const mon = await nextDow(1); // next Monday
    const seeded: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await setup.query<{ d: Date }>(`SELECT ($1::date + $2::int) AS d`, [mon, i]);
      const d = res.rows[0].d.toISOString().slice(0, 10);
      await seedShift(d);
      seeded.push(d);
    }
    const lastSeeded = seeded[seeded.length - 1]; // that Friday

    // The Wednesday one week AFTER the tail — the "Aug 26" of this test.
    const wedAfterTail = await setup.query<{ d: Date }>(
      `SELECT ($1::date + 7 - 2)::date AS d`, // Friday + 7 - 2 = following Wednesday
      [lastSeeded]
    );
    const targetWed = wedAfterTail.rows[0].d.toISOString().slice(0, 10);

    expect(await shiftDates()).not.toContain(targetWed); // the bug state

    const { rowsInserted } = await run(90);
    expect(rowsInserted).toBeGreaterThan(0);

    const after = await shiftDates();
    expect(after).toContain(targetWed); // NOW bookable
  });

  it('HAPPY: the projected rows carry the same hours (1–5, not a default)', async () => {
    const mon = await nextDow(1);
    await seedShift(mon, '13:00', '17:00');

    await run(60);

    const res = await setup.query<{ start_time: string; end_time: string }>(
      `SELECT start_time, end_time FROM employee_schedule
        WHERE tenant_id = $1 AND shift_date > $2 ORDER BY shift_date LIMIT 1`,
      [tenantId, mon]
    );
    expect(res.rows[0].start_time).toBe('13:00:00');
    expect(res.rows[0].end_time).toBe('17:00:00');
  });

  it("SAD: does NOT invent a weekday the owner doesn't work", async () => {
    // WHO: an owner who works Mon/Wed/Fri only.
    // WHY: this is why the pattern is read from the TAIL WEEK rather than "the
    //       most recent row per weekday". If an owner STOPS working Tuesdays, the
    //       last Tuesday row still sits in the past — keying off it would
    //       resurrect Tuesdays forever, silently booking them into a day they
    //       don't work. That's worse than the bug we're fixing.
    const mon = await nextDow(1);
    const wed = await setup.query<{ d: Date }>(`SELECT ($1::date + 2) AS d`, [mon]);
    await seedShift(mon);
    await seedShift(wed.rows[0].d.toISOString().slice(0, 10));

    await run(30);

    const dows = await setup.query<{ dow: number }>(
      `SELECT DISTINCT EXTRACT(DOW FROM shift_date)::int AS dow
         FROM employee_schedule WHERE tenant_id = $1 ORDER BY dow`,
      [tenantId]
    );
    expect(dows.rows.map((r) => r.dow).sort()).toEqual([1, 3]); // Mon + Wed ONLY
  });

  it('SAD: never clobbers a day the owner explicitly marked OFF', async () => {
    // WHY: a day off is a deliberate act. ON CONFLICT DO NOTHING must leave it
    //       alone — silently un-booking someone's vacation would be a serious
    //       breach of trust, and it would look like the system "forgot".
    const mon = await nextDow(1);
    await seedShift(mon);
    const monNextWeek = await setup.query<{ d: Date }>(`SELECT ($1::date + 7) AS d`, [mon]);
    const offDay = monNextWeek.rows[0].d.toISOString().slice(0, 10);
    await seedShift(offDay, '00:00', '00:00', true); // marked OFF

    await run(30);

    const res = await setup.query<{ is_off: boolean }>(
      `SELECT is_off FROM employee_schedule WHERE tenant_id = $1 AND shift_date = $2`,
      [tenantId, offDay]
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].is_off).toBe(true); // still off
  });

  it('SAD: is idempotent — a second run inserts nothing', async () => {
    // The worker ticks daily, forever. If it were not a no-op once the horizon
    // is covered, it would churn the table and the audit log endlessly.
    await seedShift(await nextDow(1));
    const first = await run(30);
    expect(first.rowsInserted).toBeGreaterThan(0);

    const second = await run(30);
    expect(second.rowsInserted).toBe(0);
  });

  it('SAD: an employee with NO schedule at all is left alone (nothing to extrapolate)', async () => {
    // A brand-new employee, or one who has never been given a shift, has no
    // pattern. We must not guess one — inventing hours for a person is worse than
    // leaving them unbookable, because the caller would be booked with someone who
    // isn't there.
    const { rowsInserted } = await run(30);
    expect(rowsInserted).toBe(0);
    expect(await shiftDates()).toHaveLength(0);
  });

  it('HAPPY: repairs a schedule that ALREADY lapsed (backfills from today)', async () => {
    // WHO: a tenant whose calendar ran out weeks ago — which is where Thinking
    //       Hammer was heading, and where any tenant ends up if nobody clicks
    //       "copy week".
    // WHAT: the target range starts at CURRENT_DATE, not at the tail, so a dead
    //        schedule comes back to life on the next tick rather than staying dead.
    const past = await dayOffset(-14); // a Monday-ish two weeks ago, whatever DOW
    await seedShift(past);

    const { rowsInserted } = await run(30);

    expect(rowsInserted).toBeGreaterThan(0);

    // Precompute today ONCE and filter synchronously. An async predicate inside
    // .filter() returns a Promise — which is always truthy — so the assertion
    // would pass no matter what, verifying nothing. (Caught in review on PR #242.)
    const today = await dayOffset(0);
    const after = await shiftDates();
    const future = after.filter((d) => d > today);
    expect(future.length).toBeGreaterThan(0);
  });
});

describe('extendSchedules — the DECLARED weekly rule (employee_schedule_pattern)', () => {
  it('REGRESSION: one far-future one-off shift no longer hijacks the pattern', async () => {
    // WHO: an owner who works Mon–Fri 1–5 and put "annual inventory Saturday"
    //      on the calendar 300 days out.
    // WHAT: `tail` used to be MAX(shift_date) over ALL TIME, so that single
    //       Saturday became the tail week — the derived pattern turned
    //       Saturday-only, Mon–Fri quietly stopped being extended, and the
    //       business went unbookable in ~180 days.
    // WHEN: the daily extender tick, silently, for months.
    // WHERE: src/services/extendSchedules.ts, the tail CTE.
    // WHY: killed by the worker written to prevent exactly this. The tail is
    //      now clamped to CURRENT_DATE + 14, which puts a far-future one-off
    //      out of reach without touching the lapsed-schedule backfill.
    const mon = await nextDow(1);
    for (let i = 0; i < 5; i++) {
      const d = await setup.query<{ d: Date }>(`SELECT ($1::date + $2::int) AS d`, [mon, i]);
      await seedShift(d.rows[0].d.toISOString().slice(0, 10));
    }
    // The poison: a lone Saturday 300 days out.
    const farSaturday = await setup.query<{ d: Date }>(
      `SELECT (CURRENT_DATE + 300 + ((6 - EXTRACT(DOW FROM CURRENT_DATE + 300)::int + 7) % 7))::date AS d`
    );
    await seedShift(farSaturday.rows[0].d.toISOString().slice(0, 10), '09:00', '12:00');

    const { rowsInserted } = await run(90);
    expect(rowsInserted).toBeGreaterThan(0);

    // The Wednesday three weeks out — a normal weekday inside normal hours,
    // and the thing the caller on 2026-07-12 could not book. Under the
    // all-time tail it does not exist, because the pattern was Saturday.
    const wedFarOut = await setup.query<{ d: Date }>(`SELECT ($1::date + 2 + 14)::date AS d`, [
      mon,
    ]);
    expect(await shiftDates()).toContain(wedFarOut.rows[0].d.toISOString().slice(0, 10));

    // Mon–Fri projected; NO Saturday invented inside the horizon. (The seeded
    // one at +300 is outside this window and is not the extender's doing.)
    expect(await scheduledDows(90)).toEqual([1, 2, 3, 4, 5]);
  });

  it('HAPPY: the declared rule projects with no existing rows to derive from', async () => {
    // WHO: a newly provisioned employee whose owner filled in the weekly grid.
    // WHAT: the rule alone is enough — no seeded employee_schedule rows at all.
    // WHY: this is the whole point of storing the rule. Before it, an employee
    //      with no rows had no pattern and the extender could do nothing but
    //      leave them unbookable.
    await seedRule(2, '09:00', '12:00'); // Tuesdays

    const { rowsInserted } = await run(30);

    expect(rowsInserted).toBeGreaterThan(0);
    expect(await scheduledDows()).toEqual([2]);

    const hours = await setup.query<{ start_time: string; end_time: string }>(
      `SELECT start_time, end_time FROM employee_schedule
        WHERE tenant_id = $1 ORDER BY shift_date LIMIT 1`,
      [tenantId]
    );
    expect(hours.rows[0].start_time).toBe('09:00:00');
    expect(hours.rows[0].end_time).toBe('12:00:00');
  });

  it('HAPPY: the declared rule BEATS whatever the rows would have implied', async () => {
    // WHO: an owner whose stated hours are Mon + Wed, whose last week of rows
    //      happens to contain only a Thursday (a one-off cover shift).
    // WHAT: with a rule present the derivation is skipped entirely for that
    //       employee — the tail CTE excludes them.
    // WHY: a stated intent must outrank an inference drawn from history, or
    //      storing the intent bought us nothing.
    const thu = await nextDow(4);
    await seedShift(thu, '08:00', '10:00');
    await seedRule(1);
    await seedRule(3);

    await run(30);

    // Thursday exists only as the seeded row; it is never projected forward.
    const thursdays = await setup.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM employee_schedule
        WHERE tenant_id = $1 AND EXTRACT(DOW FROM shift_date)::int = 4`,
      [tenantId]
    );
    expect(Number(thursdays.rows[0].n)).toBe(1);
    expect(await scheduledDows()).toEqual([1, 3, 4]);
  });

  it('SAD: a rule + rows do not double-insert, and a second run is still a no-op', async () => {
    // WHY: `pattern` is declared UNION ALL derived. If the tail CTE ever stopped
    //      excluding rule-bearing employees the two would overlap, and the
    //      INSERT would try the same (tenant, employee, date) twice in one
    //      statement — which ON CONFLICT DO NOTHING does NOT save you from
    //      ("cannot affect row a second time").
    await seedShift(await nextDow(1));
    await seedRule(1);

    const first = await run(30);
    expect(first.rowsInserted).toBeGreaterThan(0);
    const second = await run(30);
    expect(second.rowsInserted).toBe(0);
  });

  it('SAD: an inactive employee is skipped even with a declared rule', async () => {
    // WHY: the rule table has no is_active column and must not become a way
    //      around the employees filter — a departed employee must not be
    //      projected back onto the calendar.
    const gone = await setup.query<{ employee_id: string }>(
      `INSERT INTO employees (tenant_id, name, is_active) VALUES ($1, 'Departed Dana', false)
       RETURNING employee_id`,
      [tenantId]
    );
    await setup.query(
      `INSERT INTO employee_schedule_pattern (tenant_id, employee_id, day_of_week, start_time, end_time)
       VALUES ($1, $2, 1, '13:00', '17:00')`,
      [tenantId, gone.rows[0].employee_id]
    );

    const { rowsInserted } = await run(30);

    expect(rowsInserted).toBe(0);
    await setup.query(`DELETE FROM employees WHERE employee_id = $1`, [gone.rows[0].employee_id]);
  });
});
