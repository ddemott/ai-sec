/**
 * T-010 — how an EXISTING tenant adopts the declared weekly rule.
 *
 * WHO  — every tenant provisioned before migration 20260820000000, i.e. every
 *        tenant that exists today. That migration added
 *        `employee_schedule_pattern` and DELIBERATELY did not backfill it:
 *        inventing a rule from historical rows is the exact "row archaeology"
 *        the table was created to end.
 * WHAT — until the owner next saves their hours, the extender keeps guessing
 *        from a CLAMPED tail window; the moment they save, the guess is
 *        replaced by the rule they stated.
 * WHEN  — the daily extender tick, and any POST /shifts/expand-weekly.
 * WHERE — src/services/extendSchedules.ts + src/services/expandWeeklyToSchedule.ts.
 * WHY  — this is the ONLY adoption path there is, and nothing in the product
 *        tells an owner it exists. If the save did not write the rule, or the
 *        extender did not switch to it, a legacy tenant would sit on the
 *        derived fallback forever and nobody would find out until a caller was
 *        told "no one is scheduled that day". The operational consequence is
 *        documented in docs/RUNBOOK.md; these tests are what make the
 *        documentation true.
 *
 * REAL POSTGRES, not a mock: the extender is one SQL statement whose whole
 * behaviour lives in a tail-window CTE, a generate_series/EXTRACT(DOW) join and
 * an ON CONFLICT. A mock would only prove the string is the string.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { type Client, Pool } from 'pg';
import { API_DB_URL, getRootClient, createTenant, skipIfDbDown } from '../utils';
import { createWithTenantClient } from '../../src/database';
import { extendSchedules } from '../../src/services/extendSchedules';
import { expandWeeklyToSchedule } from '../../src/services/expandWeeklyToSchedule';

let setup: Client;
let pool: Pool;
let dbAvailable = false;
let tenantId: string;
let employeeId: string;
const tenantsToClean: string[] = [];

async function seedShift(date: string, start = '13:00', end = '17:00') {
  await setup.query(
    `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
     VALUES ($1, $2, $3, $4, $5, false)
     ON CONFLICT (tenant_id, employee_id, shift_date) DO NOTHING`,
    [tenantId, employeeId, date, start, end]
  );
}

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

async function patternRows(): Promise<Array<{ dow: number; start: string; end: string }>> {
  const res = await setup.query<{ day_of_week: number; start_time: string; end_time: string }>(
    `SELECT day_of_week, start_time, end_time
       FROM employee_schedule_pattern
      WHERE tenant_id = $1 AND employee_id = $2
      ORDER BY day_of_week`,
    [tenantId, employeeId]
  );
  return res.rows.map((r) => ({ dow: r.day_of_week, start: r.start_time, end: r.end_time }));
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

/** Run the extender with tenant context (employees is RLS-guarded, no bypass). */
async function runExtender(horizonDays = 90) {
  const withTenantClient = createWithTenantClient(pool);
  return withTenantClient(tenantId, (client) => extendSchedules(client, { horizonDays }));
}

/** Save weekly hours the way POST /shifts/expand-weekly and the wizard do. */
async function saveWeeklyHours(pattern: Array<{ day_of_week: number; start: string; end: string }>) {
  const withTenantClient = createWithTenantClient(pool);
  return withTenantClient(tenantId, (client) =>
    expandWeeklyToSchedule(client, {
      tenantId,
      employeeId,
      pattern: pattern.map((p) => ({
        day_of_week: p.day_of_week,
        start_time: p.start,
        end_time: p.end,
      })),
      weeksAhead: 4,
    })
  );
}

beforeAll(async () => {
  try {
    setup = await getRootClient();
    await setup.query('SELECT 1');
    pool = new Pool({ connectionString: API_DB_URL, max: 5 });
    tenantId = await createTenant(setup, 'Pattern Adoption Co', 'auto-shop');
    tenantsToClean.push(tenantId);
    const emp = await setup.query<{ employee_id: string }>(
      `INSERT INTO employees (tenant_id, name, is_active) VALUES ($1, 'Legacy Lee', true)
       RETURNING employee_id`,
      [tenantId]
    );
    employeeId = emp.rows[0].employee_id;
    dbAvailable = true;
  } catch (err) {
    console.warn('[schedulePatternAdoption.realdb] DB not available, skipping', err);
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

describe('T-010: a legacy tenant with NO declared rule', () => {
  it('HAPPY: has no pattern row at all — the migration backfilled nothing, on purpose', async () => {
    // The absence IS the design. A backfill would have to guess the rule from
    // rows, which is the failure mode the table exists to remove.
    await seedShift(await nextDow(1));
    expect(await patternRows()).toEqual([]);
  });

  it('REGRESSION: a far-future one-off shift cannot poison the derived pattern', async () => {
    // The clamp under test: the tail window ends at CURRENT_DATE + 14, not at
    // MAX(shift_date) over all time. Remove the clamp and the lone Saturday 300
    // days out becomes the whole tail week — Mon–Fri silently stop extending
    // and the business is unbookable in ~180 days, killed by the worker written
    // to prevent exactly that.
    const mon = await nextDow(1);
    for (let i = 0; i < 5; i++) {
      const d = await setup.query<{ d: Date }>(`SELECT ($1::date + $2::int) AS d`, [mon, i]);
      await seedShift(d.rows[0].d.toISOString().slice(0, 10));
    }
    const farSaturday = await setup.query<{ d: Date }>(
      `SELECT (CURRENT_DATE + 300 + ((6 - EXTRACT(DOW FROM CURRENT_DATE + 300)::int + 7) % 7))::date AS d`
    );
    await seedShift(farSaturday.rows[0].d.toISOString().slice(0, 10), '09:00', '12:00');

    const { rowsInserted } = await runExtender(90);

    expect(rowsInserted).toBeGreaterThan(0);
    expect(await scheduledDows(90)).toEqual([1, 2, 3, 4, 5]);
    // And it is still running on the FALLBACK — nothing here invents a rule.
    expect(await patternRows()).toEqual([]);
  });
});

describe('T-010: the adoption trigger — the owner saves their hours', () => {
  it('HAPPY: saving weekly hours writes the declared rule for every weekday saved', async () => {
    // This is the whole adoption path. There is no other one, and no UI tells
    // the owner it exists — which is why it is written down in the RUNBOOK.
    await saveWeeklyHours([
      { day_of_week: 1, start: '09:00', end: '17:00' },
      { day_of_week: 3, start: '09:00', end: '17:00' },
    ]);

    expect(await patternRows()).toEqual([
      { dow: 1, start: '09:00:00', end: '17:00:00' },
      { dow: 3, start: '09:00:00', end: '17:00:00' },
    ]);
  });

  it('HAPPY: after the save the extender projects the DECLARED rule, not the rows', async () => {
    // Seed history that disagrees with the stated hours — a one-off Thursday
    // cover shift, the kind of row the derivation would happily latch onto.
    await seedShift(await nextDow(4), '18:00', '20:00');
    await saveWeeklyHours([
      { day_of_week: 2, start: '09:00', end: '12:00' },
      { day_of_week: 4, start: '09:00', end: '12:00' },
    ]);

    await runExtender(90);

    // Beyond the 4 weeks expandWeeklyToSchedule itself wrote, only the declared
    // weekdays appear — the extender is projecting the rule.
    const res = await setup.query<{ dow: number }>(
      `SELECT DISTINCT EXTRACT(DOW FROM shift_date)::int AS dow
         FROM employee_schedule
        WHERE tenant_id = $1 AND shift_date > CURRENT_DATE + 28
        ORDER BY dow`,
      [tenantId]
    );
    expect(res.rows.map((r) => r.dow)).toEqual([2, 4]);
  });

  it('SAD: dropping a weekday on re-save RETIRES it — the rule is replaced, never merged', async () => {
    // A merged rule would resurrect the dropped weekday forever, which is the
    // same bug one table over. The owner works Mon+Wed, then drops Wednesday.
    await saveWeeklyHours([
      { day_of_week: 1, start: '09:00', end: '17:00' },
      { day_of_week: 3, start: '09:00', end: '17:00' },
    ]);
    await saveWeeklyHours([{ day_of_week: 1, start: '09:00', end: '17:00' }]);

    expect(await patternRows()).toEqual([{ dow: 1, start: '09:00:00', end: '17:00:00' }]);

    await runExtender(90);
    const res = await setup.query<{ dow: number }>(
      `SELECT DISTINCT EXTRACT(DOW FROM shift_date)::int AS dow
         FROM employee_schedule
        WHERE tenant_id = $1 AND shift_date > CURRENT_DATE + 28
        ORDER BY dow`,
      [tenantId]
    );
    expect(res.rows.map((r) => r.dow)).toEqual([1]);
  });

  it('SAD: an EMPTY pattern does not wipe a working rule', async () => {
    // "This employee has no hours" and "the caller sent nothing" arrive
    // identically here, and wiping a working rule on the ambiguous reading is
    // how a bookable business goes dark. The callers that MEAN "no hours"
    // delete the rule themselves, beside the delete of the future rows.
    await saveWeeklyHours([{ day_of_week: 1, start: '09:00', end: '17:00' }]);
    await saveWeeklyHours([]);
    expect(await patternRows()).toEqual([{ dow: 1, start: '09:00:00', end: '17:00:00' }]);
  });
});
