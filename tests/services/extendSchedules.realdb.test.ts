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
