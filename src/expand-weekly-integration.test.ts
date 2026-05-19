/**
 * Integration test for expandWeeklyToSchedule against a real Postgres.
 *
 * Why this exists alongside the mock-based unit tests:
 *
 * The unit tests in src/services/expandWeeklyToSchedule.test.ts mock
 * the PoolClient — they're fast and deterministic but completely blind
 * to schema reality. If a future migration drops `employee_schedule`,
 * renames a column, or changes the UNIQUE constraint, those mock-based
 * tests would still pass.
 *
 * This file exercises the full helper end-to-end against the local
 * Docker Postgres on port 5433. If migrations are missing or schemas
 * drift, the test fails loudly. Skips gracefully when the local DB
 * isn't running (CI without Docker, fresh clone, etc.).
 *
 * Each test creates its own tenant + employee inside a savepoint and
 * rollbacks at the end — fully independent.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { type Client } from 'pg';
import type { PoolClient } from 'pg';
import { getRootClient, clearDB, beginTestTransaction, rollbackTestTransaction, createTenant, createEmployee, skipIfDbDown } from './test-utils';
import { expandWeeklyToSchedule } from './services/expandWeeklyToSchedule';

let client: Client;
let dbAvailable = false;
beforeEach((ctx) => skipIfDbDown(ctx, () => dbAvailable));

beforeAll(async () => {
  try {
    client = await getRootClient();
    dbAvailable = true;
    await clearDB(client);
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (client) await client.end();
});

beforeEach(async () => {
  if (dbAvailable) await beginTestTransaction(client);
});

afterEach(async () => {
  if (dbAvailable) await rollbackTestTransaction(client);
});

const MONDAY_2026_04_27 = new Date('2026-04-27T00:00:00.000Z');

describe('expandWeeklyToSchedule integration — real Postgres', () => {
  it('1. fans Mon-Fri 9-5 pattern into 4 weeks of employee_schedule rows', async () => {
    // WHO: setup wizard finishing solo onboarding for a fresh tenant.
    // WHAT: 5 pattern entries × 4 weeks = 20 employee_schedule rows.
    //       Verify both the count and each row's shape (date,
    //       start_time, end_time, is_off).
    // WHERE: src/services/expandWeeklyToSchedule.ts running against
    //       the real schema — proves migration 20260403000000 +
    //       20260420000000 are applied to test_db.
    // WHEN: every wizard finalize for a brand-new tenant.
    // WHY: mock tests can't catch schema drift (renames, missing
    //       columns, removed constraints). This test fails loudly if
    //       any of those regressions ship.
    if (!dbAvailable) return;

    const tenantId = await createTenant(client, 'IntegrationTest1', 'mobile-tire');
    const employeeId = await createEmployee(client, tenantId, 'Solo Owner');
    const monFriPattern = [1, 2, 3, 4, 5].map((dow) => ({
      day_of_week: dow,
      start_time: '09:00',
      end_time: '17:00',
    }));

    const result = await expandWeeklyToSchedule(client as unknown as PoolClient, {
      tenantId,
      employeeId,
      pattern: monFriPattern,
      weeksAhead: 4,
      startDate: MONDAY_2026_04_27,
    });

    expect(result.inserted).toBe(20);
    expect(result.rangeStart).toBe('2026-04-27');
    expect(result.rangeEnd).toBe('2026-05-24');

    // Verify the actual rows exist in employee_schedule with the right shape.
    const stored = await client.query(
      `SELECT shift_date::text AS shift_date, start_time::text AS start_time,
              end_time::text AS end_time, is_off
         FROM employee_schedule
        WHERE tenant_id = $1 AND employee_id = $2
        ORDER BY shift_date ASC`,
      [tenantId, employeeId]
    );
    expect(stored.rows).toHaveLength(20);
    expect(stored.rows[0].shift_date).toBe('2026-04-27'); // first Monday
    expect(stored.rows[0].start_time).toBe('09:00:00');
    expect(stored.rows[0].end_time).toBe('17:00:00');
    expect(stored.rows[0].is_off).toBe(false);
  });

  it('2. is idempotent — re-running inserts zero new rows and preserves existing overrides', async () => {
    // WHO: any caller that re-fires the fan-out (wizard re-open, future
    //      cron extending the rolling window, manual admin invocation).
    // WHAT: second call returns inserted: 0 because every (tenant,
    //       employee, date) tuple already exists. Critically, an owner
    //       override that landed BETWEEN the two calls must survive —
    //       ON CONFLICT DO NOTHING is what protects them.
    // WHERE: the per-INSERT ON CONFLICT clause in the helper, validated
    //       against the real UNIQUE(tenant_id, employee_id, shift_date)
    //       constraint on employee_schedule.
    // WHEN: every re-run scenario. Especially relevant once the wizard
    //       supports editing — owners may finalize twice.
    // WHY: a mock can't test the DB's actual UNIQUE constraint. If the
    //       migration ever drops or renames it, this test fails.
    if (!dbAvailable) return;

    const tenantId = await createTenant(client, 'IntegrationTest2', 'salon');
    const employeeId = await createEmployee(client, tenantId, 'Re-Run Owner');
    const monPattern = [{ day_of_week: 1, start_time: '09:00', end_time: '17:00' }];

    // First fan: 4 Mondays in 4 weeks.
    const first = await expandWeeklyToSchedule(client as unknown as PoolClient, {
      tenantId,
      employeeId,
      pattern: monPattern,
      weeksAhead: 4,
      startDate: MONDAY_2026_04_27,
    });
    expect(first.inserted).toBe(4);

    // Owner edits May 4 to take the day off — simulates an override
    // made via the Front Desk scheduler between fan-out calls.
    await client.query(
      `UPDATE employee_schedule SET is_off = true, start_time = NULL, end_time = NULL
       WHERE tenant_id = $1 AND employee_id = $2 AND shift_date = '2026-05-04'`,
      [tenantId, employeeId]
    );

    // Second fan-out — should be a no-op because every date already exists.
    const second = await expandWeeklyToSchedule(client as unknown as PoolClient, {
      tenantId,
      employeeId,
      pattern: monPattern,
      weeksAhead: 4,
      startDate: MONDAY_2026_04_27,
    });
    expect(second.inserted).toBe(0);

    // Verify the May 4 override survived.
    const may4 = await client.query(
      `SELECT is_off FROM employee_schedule
        WHERE tenant_id = $1 AND employee_id = $2 AND shift_date = '2026-05-04'`,
      [tenantId, employeeId]
    );
    expect(may4.rows[0].is_off).toBe(true);
  });

  it('3. extending the window inserts only the new dates, not duplicates', async () => {
    // WHO: future caller that wants to extend an existing schedule
    //      (e.g., a cron job rolling the 4-week window forward each
    //      week, or a UI button "extend by 4 more weeks").
    // WHAT: starting from a 1-week fan-out, then re-firing with
    //       weeks_ahead=2 should add only the second week's matching
    //       days. The first week's rows must NOT be duplicated.
    // WHERE: ON CONFLICT DO NOTHING + the date-range loop in the helper.
    // WHEN: rolling-window scenarios that don't exist yet but will.
    // WHY: pins down the "extend without duplicating" property — the
    //       most subtle correctness invariant for any future caller
    //       that re-uses this helper for windowed regeneration.
    if (!dbAvailable) return;

    const tenantId = await createTenant(client, 'IntegrationTest3', 'auto-shop');
    const employeeId = await createEmployee(client, tenantId, 'Window Extender');
    const monPattern = [{ day_of_week: 1, start_time: '08:00', end_time: '16:00' }];

    // First: just 1 week.
    const first = await expandWeeklyToSchedule(client as unknown as PoolClient, {
      tenantId,
      employeeId,
      pattern: monPattern,
      weeksAhead: 1,
      startDate: MONDAY_2026_04_27,
    });
    expect(first.inserted).toBe(1); // 1 Monday

    // Second: 2 weeks. Week 1 is already in DB; only week 2's Monday
    // (2026-05-04) should be new.
    const second = await expandWeeklyToSchedule(client as unknown as PoolClient, {
      tenantId,
      employeeId,
      pattern: monPattern,
      weeksAhead: 2,
      startDate: MONDAY_2026_04_27,
    });
    expect(second.inserted).toBe(1); // only May 4 added

    const dates = await client.query(
      `SELECT shift_date::text AS d FROM employee_schedule
        WHERE tenant_id = $1 AND employee_id = $2 ORDER BY shift_date`,
      [tenantId, employeeId]
    );
    expect(dates.rows.map((r) => r.d)).toEqual(['2026-04-27', '2026-05-04']);
  });

  it('4. caller controls which days fan out — passing only Sun+Mon skips other weekdays', async () => {
    // WHO: owner who set Sun + Mon hours in the wizard and turned off
    //      every other day. The wizard sends only those two pattern
    //      entries; the helper should skip everything else.
    // WHAT: pattern with day_of_week 0 (Sun) + 1 (Mon) over a 1-week
    //       window from a Monday → exactly 2 inserts (Mon Apr 27 +
    //       Sun May 3 — that week's Sunday is the last day in a
    //       Mon-anchored week).
    // WHERE: helper's per-day matching against patternByDow Map.
    // WHEN: any partial-week pattern. Common: weekend-only employees,
    //       weekday-only owners.
    // WHY: pre-rip-out the helper read employee_shifts and filtered by
    //      is_active. Now the caller is fully responsible for which
    //      days appear in the pattern array. This test pins that
    //      contract: helper inserts only what's passed, nothing more.
    if (!dbAvailable) return;

    const tenantId = await createTenant(client, 'IntegrationTest4', 'salon');
    const employeeId = await createEmployee(client, tenantId, 'Selective Owner');
    const sunMonPattern = [
      { day_of_week: 0, start_time: '10:00', end_time: '14:00' },
      { day_of_week: 1, start_time: '09:00', end_time: '17:00' },
    ];

    const result = await expandWeeklyToSchedule(client as unknown as PoolClient, {
      tenantId,
      employeeId,
      pattern: sunMonPattern,
      weeksAhead: 1,
      startDate: MONDAY_2026_04_27,
    });

    // 1 Sun + 1 Mon in the week starting Mon 4/27 (Sunday is May 3,
    // the week's last day per startDate=Mon).
    expect(result.inserted).toBe(2);

    const stored = await client.query(
      `SELECT shift_date::text AS d FROM employee_schedule
        WHERE tenant_id = $1 AND employee_id = $2 ORDER BY shift_date`,
      [tenantId, employeeId]
    );
    expect(stored.rows.map((r) => r.d)).toEqual(['2026-04-27', '2026-05-03']);
    // Critically, no Tuesday/Wednesday/etc. rows.
  });
});
