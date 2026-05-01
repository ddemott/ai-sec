/**
 * Fan-out helper: weekly `employee_shifts` rows → date-specific `employee_schedule` rows.
 *
 * Background: the setup wizard writes weekly availability patterns to
 * `employee_shifts` (day_of_week 0-6). The booking RPCs only read
 * `employee_schedule` (date-specific rows). Without this fan-out, an
 * owner finishing onboarding could not book — the booking flow would
 * return EMPLOYEE_NOT_SCHEDULED for every date.
 *
 * This module is the bridge: it reads the employee's current weekly
 * pattern and inserts matching date-specific rows for the next N weeks.
 * Idempotent via ON CONFLICT DO NOTHING — re-running won't overwrite
 * existing date-specific entries (which the owner may have edited in
 * the Front Desk scheduler).
 *
 * Phase 2 (separate session) will retire `employee_shifts` entirely
 * once the wizard reads + writes `employee_schedule` directly.
 */

import type { PoolClient } from 'pg';

export interface ExpandWeeklyParams {
  tenantId: string;
  employeeId: string;
  /**
   * How many weeks of date-specific entries to generate, starting from
   * `startDate`. Default 4 — gives the owner a month of bookable
   * coverage out of the box; they can extend via the copy-week button.
   */
  weeksAhead?: number;
  /**
   * Anchor date for the first week. Default: today (UTC). Tests pass
   * a fixed date so day-of-week math is deterministic.
   */
  startDate?: Date;
}

export interface ExpandWeeklyResult {
  /** Rows actually inserted (excludes ON CONFLICT skips). */
  inserted: number;
  /**
   * Date range that was scanned. Useful for the API response so the
   * caller can show "Schedule extends through Apr 28".
   */
  rangeStart: string;
  rangeEnd: string;
}

interface WeeklyShiftRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

/**
 * Returns YYYY-MM-DD in UTC for a given Date. Postgres `DATE` columns
 * are timezone-naïve — using UTC keeps day boundaries consistent
 * across environments.
 */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function expandWeeklyToSchedule(
  client: PoolClient,
  params: ExpandWeeklyParams
): Promise<ExpandWeeklyResult> {
  const weeksAhead = params.weeksAhead ?? 4;
  const startDate = params.startDate ?? new Date();

  // Read this employee's current weekly pattern. Only active rows —
  // an owner who toggled a day off shouldn't see it re-fanned.
  const weeklyRes = await client.query<WeeklyShiftRow>(
    `SELECT day_of_week, start_time::text AS start_time, end_time::text AS end_time
     FROM employee_shifts
     WHERE tenant_id = $1 AND employee_id = $2
       AND (is_active IS NULL OR is_active = true)`,
    [params.tenantId, params.employeeId]
  );

  if (weeklyRes.rows.length === 0) {
    // Nothing to fan out. Not an error — owner may not have set hours yet.
    return {
      inserted: 0,
      rangeStart: toIsoDate(startDate),
      rangeEnd: toIsoDate(startDate),
    };
  }

  // Build date list: each day from startDate through startDate+(weeksAhead*7)-1.
  const dayCount = weeksAhead * 7;
  const dates: { date: Date; dow: number; iso: string }[] = [];
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push({
      date: d,
      dow: d.getUTCDay(),
      iso: toIsoDate(d),
    });
  }

  // Index the weekly pattern by day_of_week for O(1) lookup.
  const patternByDow = new Map<number, WeeklyShiftRow>();
  for (const row of weeklyRes.rows) {
    patternByDow.set(row.day_of_week, row);
  }

  // Insert one row per (date, matching weekly pattern). ON CONFLICT
  // DO NOTHING preserves any existing date-specific edits.
  let inserted = 0;
  for (const { iso, dow } of dates) {
    const pattern = patternByDow.get(dow);
    if (!pattern) continue;

    const res = await client.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ($1, $2, $3::DATE, $4::TIME, $5::TIME, false)
       ON CONFLICT (tenant_id, employee_id, shift_date) DO NOTHING`,
      [params.tenantId, params.employeeId, iso, pattern.start_time, pattern.end_time]
    );
    inserted += res.rowCount ?? 0;
  }

  return {
    inserted,
    rangeStart: dates[0].iso,
    rangeEnd: dates[dates.length - 1].iso,
  };
}
