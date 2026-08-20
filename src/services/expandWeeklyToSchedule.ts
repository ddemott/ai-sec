/**
 * Fan-out helper: caller-supplied weekly pattern → date-specific
 * `employee_schedule` rows.
 *
 * The setup wizard collects the owner's weekly availability in form
 * state and passes it directly to this helper at finalize. There is
 * no separate `employee_shifts` table involved — `employee_schedule`
 * is the only schedule storage the booking RPCs read, and this helper
 * is the only place that fans a weekly pattern into it.
 *
 * Idempotent via ON CONFLICT DO NOTHING — re-running won't overwrite
 * existing date-specific entries (which the owner may have edited in
 * the Front Desk scheduler).
 *
 * IT ALSO RECORDS THE RULE, not just the rows it produced. `employee_schedule`
 * stores one concrete row per date and no statement of intent, so for years the
 * only way to answer "does this owner work Wednesdays?" was to guess it back
 * out of the rows — and the schedule extender's guess was poisonable by a
 * single far-future one-off shift (see extendSchedules.ts). The pattern the
 * caller hands us here IS that statement of intent, and throwing it away was
 * the actual defect. It now lands in `employee_schedule_pattern` as well.
 *
 * The rule is REPLACED, not merged: both callers (POST /shifts/expand-weekly
 * and the setup wizard's graph sync) pass the COMPLETE weekly pattern for one
 * employee, so a weekday absent from `pattern` means the owner dropped it. If
 * it were merged instead, dropping Wednesday would leave a stale Wednesday rule
 * that the extender projects forever — the same bug one table over.
 */

import type { PoolClient } from 'pg';

/**
 * One row of the weekly pattern. day_of_week is 0-6 (Sun=0).
 * start_time / end_time are 'HH:MM' or 'HH:MM:SS' strings — the
 * Postgres TIME column accepts either.
 */
export interface WeeklyShiftRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface ExpandWeeklyParams {
  tenantId: string;
  employeeId: string;
  /** Caller-supplied weekly pattern. Empty array → no-op (no inserts). */
  pattern: WeeklyShiftRow[];
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

/**
 * Returns YYYY-MM-DD in UTC for a given Date. Postgres `DATE` columns
 * are timezone-naïve — using UTC keeps day boundaries consistent
 * across environments.
 */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Write the declared weekly rule for ONE employee, replacing whatever was
 * there. Two statements rather than one so a weekday the owner removed is
 * actually removed — an upsert alone can only ever add or change a row, never
 * retire one.
 */
async function replaceWeeklyRule(
  client: PoolClient,
  tenantId: string,
  employeeId: string,
  patternByDow: Map<number, WeeklyShiftRow>
): Promise<void> {
  const dows = [...patternByDow.keys()];

  // Retire weekdays the owner dropped. `<> ALL(...)` on a non-empty array is
  // safe here because the empty-pattern case returned before we got here.
  await client.query(
    `DELETE FROM employee_schedule_pattern
      WHERE tenant_id = $1 AND employee_id = $2 AND day_of_week <> ALL($3::smallint[])`,
    [tenantId, employeeId, dows]
  );

  const valuesSql: string[] = [];
  const flatParams: (string | number)[] = [];
  let i = 0;
  for (const [dow, row] of patternByDow) {
    const base = i * 5;
    valuesSql.push(
      `($${base + 1}, $${base + 2}, $${base + 3}::SMALLINT, $${base + 4}::TIME, $${base + 5}::TIME)`
    );
    flatParams.push(tenantId, employeeId, dow, row.start_time, row.end_time);
    i++;
  }

  await client.query(
    `INSERT INTO employee_schedule_pattern
       (tenant_id, employee_id, day_of_week, start_time, end_time)
     VALUES ${valuesSql.join(', ')}
     ON CONFLICT (tenant_id, employee_id, day_of_week)
       DO UPDATE SET start_time = EXCLUDED.start_time,
                     end_time   = EXCLUDED.end_time`,
    flatParams
  );
}

export async function expandWeeklyToSchedule(
  client: PoolClient,
  params: ExpandWeeklyParams
): Promise<ExpandWeeklyResult> {
  const weeksAhead = params.weeksAhead ?? 4;
  const startDate = params.startDate ?? new Date();

  if (params.pattern.length === 0) {
    // Nothing to fan out. Not an error — owner may not have set hours yet.
    //
    // Deliberately does NOT clear the stored rule. An empty pattern is
    // ambiguous ON ITS OWN — "this employee has no hours" and "the caller had
    // nothing to send" arrive identically — and wiping a working rule on the
    // ambiguous reading is how a bookable business goes dark.
    //
    // A caller that MEANS "no hours" says so explicitly, and both do: the
    // `replace` branch of POST /shifts/expand-weekly and the `prune` branch of
    // setupGraph each delete the rule themselves, right beside the delete of
    // the future employee_schedule rows, before calling this. That is where the
    // ambiguity is resolved — by the only code that knows the answer.
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
  // Last write wins — defensive against a caller supplying duplicate
  // rows for the same day.
  const patternByDow = new Map<number, WeeklyShiftRow>();
  for (const row of params.pattern) {
    patternByDow.set(row.day_of_week, row);
  }

  // Persist the RULE before fanning out the rows it implies. Order matters
  // only for a partial failure: rule-then-rows leaves the extender able to
  // project the declared pattern, whereas rows-then-rule would leave it
  // guessing again.
  await replaceWeeklyRule(client, params.tenantId, params.employeeId, patternByDow);

  // Build a single multi-row INSERT for all (date, matching pattern)
  // tuples. Single statement = single lock-acquisition window —
  // eliminates the deadlock that the per-row loop hit when another
  // transaction was cascade-DELETEing employee_schedule on a different
  // tenant mid-batch (UX audit session, 2026-05-18: surfaced under
  // full E2E load when a previous spec's `DELETE FROM tenants`
  // cascade was still committing as this batch started). ON CONFLICT
  // DO NOTHING still preserves any existing date-specific edits.
  const tuples: { iso: string; pattern: WeeklyShiftRow }[] = [];
  for (const { iso, dow } of dates) {
    const pattern = patternByDow.get(dow);
    if (pattern) tuples.push({ iso, pattern });
  }
  let inserted = 0;
  if (tuples.length > 0) {
    // Build the VALUES list as ($1,$2,$3,$4,$5,false), ($6,$7,$8,$9,$10,false), …
    // Five placeholders per tuple: tenant_id, employee_id, iso, start, end.
    const valuesSql: string[] = [];
    const flatParams: string[] = [];
    tuples.forEach((t, i) => {
      const base = i * 5;
      valuesSql.push(
        `($${base + 1}, $${base + 2}, $${base + 3}::DATE, $${base + 4}::TIME, $${base + 5}::TIME, false)`
      );
      flatParams.push(
        params.tenantId,
        params.employeeId,
        t.iso,
        t.pattern.start_time,
        t.pattern.end_time
      );
    });
    const res = await client.query(
      `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
       VALUES ${valuesSql.join(', ')}
       ON CONFLICT (tenant_id, employee_id, shift_date) DO NOTHING`,
      flatParams
    );
    inserted = res.rowCount ?? 0;
  }

  return {
    inserted,
    rangeStart: dates[0].iso,
    rangeEnd: dates[dates.length - 1].iso,
  };
}
