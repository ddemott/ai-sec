/**
 * Rolling schedule extension — keep every employee's calendar topped up so a
 * business never silently becomes unbookable.
 *
 * THE BUG THIS EXISTS TO KILL (found on a real call, 2026-07-12):
 *
 * `employee_schedule` stores one concrete row per DATE. It does not store a
 * rule. The Setup wizard collects a weekly grid ("Mon–Fri, 1–5"), fans it out
 * into ~4 weeks of individual rows via expandWeeklyToSchedule(), and then throws
 * the pattern away. Nothing in the database knows the owner works Wednesdays —
 * there are just rows, and then the calendar stops.
 *
 * So a tenant's bookable window SHRINKS BY ONE DAY, EVERY DAY. Thinking Hammer's
 * ran out on 2026-08-19: a caller asked for Wednesday Aug 26 — a normal weekday
 * inside the owner's normal 1–5 hours — and the booking RPC correctly answered
 * EMPLOYEE_NOT_SCHEDULED, because no row existed. To the caller, the AI sounded
 * like it was speaking for a company with no staff. The design assumed owners
 * would extend forward with the Schedule tab's "copy week" button. Nobody did,
 * and nobody would.
 *
 * WHAT THIS DOES: for each active employee, project their weekly pattern
 * forward until the horizon is covered. The pattern comes from one of two
 * places, in this order:
 *
 *   1. THE DECLARED RULE — `employee_schedule_pattern`, written by
 *      expandWeeklyToSchedule() straight from the weekly grid the owner filled
 *      in. This is a statement of intent, not an inference, and it is immune to
 *      every failure mode below.
 *
 *   2. THE DERIVED FALLBACK — the last week of existing rows, for employees who
 *      predate the rule table and have not re-saved their hours since. Kept
 *      because deleting it would make every existing tenant stop extending
 *      until they happened to open the wizard again.
 *
 * Why the last WEEK rather than "the most recent row for each weekday": if an
 * owner stops working Wednesdays, the last Wednesday row still sits in the past.
 * Keying off the most recent occurrence per weekday would resurrect it forever.
 * The tail week is the closest thing we have to a statement of current intent —
 * if there is no Wednesday in it, we don't invent one.
 *
 * THE FALLBACK'S TAIL IS CLAMPED TO CURRENT_DATE + 14 DAYS, and that clamp is a
 * bug fix, not a tuning knob. It used to be MAX(shift_date) over ALL TIME, so a
 * single one-off shift 300 days out ("annual inventory Saturday") made the tail
 * week Saturday-only: Mon–Fri silently stopped being extended and the business
 * went unbookable in ~180 days, killed by the worker written to prevent exactly
 * that. Clamping keeps the two properties that matter — a lapsed schedule is
 * still backfilled (the tail is wherever it actually ended, however far back),
 * and a dropped weekday is still not resurrected — while putting a far-future
 * one-off out of reach. It is a fixed point, not a feedback loop: past the
 * clamp the tail week IS this worker's own output, which is a faithful copy of
 * the same pattern.
 *
 * Other derivations were considered and are WRONG, each in its own way. A
 * "densest recent week" rule picks the busy leg of a two-week rotation and
 * over-schedules the light leg — and over-scheduling is worse than
 * under-scheduling, because it puts a real customer in front of a locked door.
 * A "last week with 3+ distinct weekdays" rule never qualifies for a
 * Saturday-only owner, so the extender never runs for them and they go
 * unbookable: the bug, re-created. All of it is archaeology on rows to recover
 * an intent we deleted on purpose, which is why item 1 exists.
 *
 * SAFETY: purely additive. ON CONFLICT DO NOTHING against the
 * (tenant_id, employee_id, shift_date) PK means an existing row — including a
 * day the owner explicitly marked OFF (is_off = true) — is never touched. A day
 * off stays off. Re-running changes nothing.
 */
import type { PoolClient } from 'pg';

/**
 * How far ahead every employee should be bookable.
 *
 * 180 rather than 90 deliberately: 90 days IS "three months", so a caller asking
 * for "the first week of November" in mid-July would land exactly on the boundary
 * and be refused — the same "no one is scheduled" dead end this service exists to
 * kill, just moved further out. Rows are tiny and the insert is idempotent, so
 * headroom is nearly free. Override with SCHEDULE_HORIZON_DAYS.
 */
export const DEFAULT_HORIZON_DAYS = 180;

/** Never project a pattern further than this in one pass (sanity bound). */
const MAX_HORIZON_DAYS = 365;

export interface ExtendResult {
  rowsInserted: number;
}

/**
 * Top up ONE tenant's active employees to `horizonDays` from today, by repeating
 * the final week of each employee's existing pattern.
 *
 * MUST be called with tenant context set (i.e. inside withTenantClient). It is
 * NOT safe as a cross-tenant sweep, and that is not a style preference — it is
 * enforced by RLS, in an asymmetric way that will bite anyone who assumes
 * otherwise:
 *
 *   employee_schedule  → HAS an admin-bypass policy (visible with no tenant ctx)
 *   employees          → tenant-isolation ONLY (INVISIBLE with no tenant ctx)
 *
 * The first draft of this ran cross-tenant like the reminder sweep, joined
 * `employees` to filter out inactive staff, silently saw zero employee rows, and
 * inserted nothing at all. The real-DB test caught it; a mock never would have.
 *
 * One statement per tenant, so it can't half-apply.
 */
export async function extendSchedules(
  client: PoolClient,
  opts: { horizonDays?: number } = {}
): Promise<ExtendResult> {
  const horizon = Math.min(
    Math.max(Math.round(opts.horizonDays ?? DEFAULT_HORIZON_DAYS), 1),
    MAX_HORIZON_DAYS
  );

  const res = await client.query(
    `
    WITH active_employee AS (
      SELECT e.tenant_id, e.employee_id
        FROM employees e
       WHERE (e.is_active IS NULL OR e.is_active = true)
    ),
    declared AS (
      -- The rule the owner actually stated, straight from the wizard. No
      -- inference, nothing to poison.
      SELECT p.tenant_id,
             p.employee_id,
             p.day_of_week::int AS dow,
             p.start_time,
             p.end_time
        FROM employee_schedule_pattern p
        JOIN active_employee a
          ON a.tenant_id = p.tenant_id
         AND a.employee_id = p.employee_id
    ),
    tail AS (
      -- Fallback only: the last day each employee is currently scheduled, IGNORING
      -- anything more than two weeks out. Employees with a declared rule are
      -- excluded outright — the rule wins and the derivation must not compete
      -- with it.
      SELECT es.tenant_id, es.employee_id, MAX(es.shift_date) AS last_date
        FROM employee_schedule es
        JOIN active_employee a
          ON a.tenant_id = es.tenant_id
         AND a.employee_id = es.employee_id
       WHERE es.is_off IS NOT TRUE
         AND es.shift_date <= CURRENT_DATE + INTERVAL '14 days'
         AND NOT EXISTS (
               SELECT 1 FROM declared d
                WHERE d.tenant_id = es.tenant_id
                  AND d.employee_id = es.employee_id
             )
       GROUP BY es.tenant_id, es.employee_id
    ),
    derived AS (
      -- The final WEEK of that schedule = the employee's current working pattern.
      -- DISTINCT ON collapses a weekday that appears twice to its latest row.
      SELECT DISTINCT ON (es.tenant_id, es.employee_id, EXTRACT(DOW FROM es.shift_date))
             es.tenant_id,
             es.employee_id,
             EXTRACT(DOW FROM es.shift_date)::int AS dow,
             es.start_time,
             es.end_time
        FROM employee_schedule es
        JOIN tail t
          ON t.tenant_id = es.tenant_id
         AND t.employee_id = es.employee_id
       WHERE es.is_off IS NOT TRUE
         AND es.shift_date >  t.last_date - INTERVAL '7 days'
         AND es.shift_date <= t.last_date
       ORDER BY es.tenant_id, es.employee_id, EXTRACT(DOW FROM es.shift_date), es.shift_date DESC
    ),
    pattern AS (
      -- Disjoint by construction: the tail CTE excludes any employee who has a
      -- declared rule, so UNION ALL cannot double-count.
      SELECT * FROM declared
      UNION ALL
      SELECT * FROM derived
    ),
    target_days AS (
      -- Every date from today through the horizon. Starting at CURRENT_DATE (not
      -- at the tail) also BACKFILLS a schedule that already lapsed — a tenant
      -- whose calendar ran out last month becomes bookable again immediately.
      SELECT d::date AS shift_date
        FROM generate_series(CURRENT_DATE, CURRENT_DATE + ($1::int - 1), INTERVAL '1 day') d
    )
    INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
    SELECT p.tenant_id, p.employee_id, t.shift_date, p.start_time, p.end_time, false
      FROM pattern p
      JOIN target_days t
        ON EXTRACT(DOW FROM t.shift_date)::int = p.dow
    ON CONFLICT (tenant_id, employee_id, shift_date) DO NOTHING
    `,
    [horizon]
  );

  return { rowsInserted: res.rowCount ?? 0 };
}
