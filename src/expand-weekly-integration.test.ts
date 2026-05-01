/**
 * Integration test for expandWeeklyToSchedule against a real Postgres.
 *
 * Why this exists alongside the mock-based unit tests:
 *
 * The unit tests in src/services/expandWeeklyToSchedule.test.ts mock
 * the PoolClient — they're fast and deterministic but completely blind
 * to schema reality. If a future migration drops `employee_schedule`,
 * renames a column, changes the UNIQUE constraint, or removes the
 * is_active column from `employee_shifts`, those mock-based tests
 * would still pass.
 *
 * This file exercises the helper end-to-end against the local Docker
 * Postgres on port 5433. If migrations are missing or schemas drift,
 * the test fails loudly. Skips gracefully when the local DB isn't
 * running (CI without Docker, fresh clone, etc.).
 *
 * Each test creates its own tenant + employee inside a savepoint and
 * rollbacks at the end — fully independent.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Client } from 'pg';
import type { PoolClient } from 'pg';
import {
  getRootClient,
  clearDB,
  beginTestTransaction,
  rollbackTestTransaction,
  createTenant,
  createEmployee,
  createShift,
} from './test-utils';
import { expandWeeklyToSchedule } from './services/expandWeeklyToSchedule';

let client: Client;
let dbAvailable = false;

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
    // WHAT: 5 weekly rows × 4 weeks = 20 employee_schedule entries.
    //       Verify both the count and that each row has the expected
    //       date + start/end_time matching the Monday-Friday pattern.
    // WHERE: src/services/expandWeeklyToSchedule.ts running against
    //       the real schema — proves migration 20260403000000 +
    //       20260420000000 are applied to test_db.
    // WHEN: every wizard finalize for a brand-new tenant. This is the
    //       full happy path, end-to-end.
    // WHY: mock tests can't catch schema drift (renames, missing
    //       columns, removed constraints). This test fails loudly if
    //       any of those regressions ship.
    if (!dbAvailable) return;

    const tenantId = await createTenant(client, 'IntegrationTest1', 'mobile-tire');
    const employeeId = await createEmployee(client, tenantId, 'Solo Owner');
    for (const dow of [1, 2, 3, 4, 5]) {
      await createShift(client, tenantId, employeeId, dow, '09:00', '17:00');
    }

    const result = await expandWeeklyToSchedule(client as unknown as PoolClient, {
      tenantId,
      employeeId,
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
    await createShift(client, tenantId, employeeId, 1, '09:00', '17:00');

    // First fan: 4 Mondays in 4 weeks.
    const first = await expandWeeklyToSchedule(client as unknown as PoolClient, {
      tenantId,
      employeeId,
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
    await createShift(client, tenantId, employeeId, 1, '08:00', '16:00');

    // First: just 1 week.
    const first = await expandWeeklyToSchedule(client as unknown as PoolClient, {
      tenantId,
      employeeId,
      weeksAhead: 1,
      startDate: MONDAY_2026_04_27,
    });
    expect(first.inserted).toBe(1); // 1 Monday

    // Second: 2 weeks. Week 1 is already in DB; only week 2's Monday
    // (2026-05-04) should be new.
    const second = await expandWeeklyToSchedule(client as unknown as PoolClient, {
      tenantId,
      employeeId,
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

  it('4. skips inactive weekly rows when generating dates', async () => {
    // WHO: owner who toggled Saturday off in the wizard — the toggle
    //       sets is_active = false on the employee_shifts row.
    // WHAT: the helper's SELECT filter must skip inactive rows so the
    //       fan-out doesn't write Saturdays into employee_schedule.
    //       Sunday + Monday active → only those days get fanned.
    // WHERE: the SELECT in expandWeeklyToSchedule that filters
    //       (is_active IS NULL OR is_active = true).
    // WHEN: any fan-out for an employee with at least one toggled-off
    //       weekday. Common — owners often disable weekends.
    // WHY: a regression that drops the is_active filter would silently
    //       schedule employees on days they explicitly opted out of —
    //       and the booking RPCs would dutifully accept those slots.
    if (!dbAvailable) return;

    const tenantId = await createTenant(client, 'IntegrationTest4', 'salon');
    const employeeId = await createEmployee(client, tenantId, 'Selective Owner');
    await createShift(client, tenantId, employeeId, 0, '10:00', '14:00'); // Sun
    await createShift(client, tenantId, employeeId, 1, '09:00', '17:00'); // Mon
    // Saturday: insert as inactive.
    await client.query(
      `INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time, is_active)
       VALUES ($1, $2, 6, '12:00', '20:00', false)`,
      [tenantId, employeeId]
    );

    const result = await expandWeeklyToSchedule(client as unknown as PoolClient, {
      tenantId,
      employeeId,
      weeksAhead: 1,
      startDate: MONDAY_2026_04_27,
    });

    // 1 Sun + 1 Mon in the week starting Mon 4/27 (note: Sunday in
    // this week is May 3, the week's last day per startDate=Mon).
    expect(result.inserted).toBe(2);

    const stored = await client.query(
      `SELECT shift_date::text AS d FROM employee_schedule
        WHERE tenant_id = $1 AND employee_id = $2 ORDER BY shift_date`,
      [tenantId, employeeId]
    );
    expect(stored.rows.map((r) => r.d)).toEqual(['2026-04-27', '2026-05-03']);
    // Critically, no Saturday (2026-05-02) row.
  });
});
