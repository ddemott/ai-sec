/**
 * Booked-vs-staffed utilization, bucketed by tenant-local weekday and hour.
 *
 * Extracted from src/routes/analytics.ts (2026-08-21).
 *
 * THREE THINGS HERE ARE CORRECTNESS, NOT PRESENTATION:
 *
 * 1. EVERYTHING IS TENANT-LOCAL. Shift times are already local; appointment
 *    timestamptz values are converted with AT TIME ZONE before bucketing. So
 *    "Tuesday 2pm" means the tenant's 2pm, matching what the booking RPCs
 *    enforce. Bucket in UTC and a shop in Chicago sees its afternoon rush
 *    reported as evening.
 *
 * 2. NIGHT SHIFTS ARE SPLIT INTO TWO SAME-DAY SEGMENTS — [00:00, end_time) and
 *    [start_time, 24:00) — both attributed to the row's own date. That mirrors
 *    book_with_scheduling_atomic(): a 1am booking on day D is validated against
 *    day D's night-shift row, because the RPC matches shift_date to the
 *    booking's LOCAL date and then tests `v_start_tod >= start OR v_end_tod <=
 *    end`. Attributing the small hours to the previous day would make this
 *    report disagree with the thing that actually accepts bookings.
 *
 * 3. ABSENT BOUNDS DEFAULT TO THE LAST 28 DAYS, not all-time. Four whole weeks
 *    means every weekday is represented an equal number of times; any other
 *    window makes whichever weekday it over-samples look artificially busy.
 *
 * `utilization` is null (never 0) when nothing was staffed, so the dashboard can
 * distinguish "closed" from "open and empty" — two very different problems for
 * an owner to look at.
 */
import type { PoolClient } from 'pg';

export interface UtilizationCell {
  dow: number;
  hour: number;
  booked_minutes: number;
  staffed_minutes: number;
  utilization: number | null;
}

export async function getUtilizationCells(
  client: PoolClient,
  tenantId: string,
  bounds: { start: string | null; end: string | null }
): Promise<UtilizationCell[]> {
  const { start, end } = bounds;
  const res = await client.query<{
    dow: number;
    hour: number;
    staffed_minutes: number;
    booked_minutes: number;
  }>(
    `WITH tenant_tz AS (
           SELECT COALESCE(timezone, 'UTC') AS tz FROM tenants WHERE tenant_id = $1
         ),
         bounds AS (
           -- Default window: last 28 days (inclusive of today, tenant-local).
           SELECT COALESCE($2::date, (now() AT TIME ZONE t.tz)::date - 27) AS start_date,
                  COALESCE($3::date, (now() AT TIME ZONE t.tz)::date) AS end_date
           FROM tenant_tz t
         ),
         -- Working shifts flattened to same-day [m_start, m_end) segments in
         -- minutes-since-midnight (24:00 → 1440). Night shifts contribute two
         -- segments (see route comment). is_off rows carry NULL times.
         shift_segments AS (
           SELECT es.shift_date,
                  (EXTRACT(EPOCH FROM es.start_time) / 60)::int AS m_start,
                  (EXTRACT(EPOCH FROM es.end_time) / 60)::int AS m_end
           FROM employee_schedule es, bounds b
           WHERE es.tenant_id = $1 AND es.is_off = false
             AND es.start_time IS NOT NULL AND es.end_time IS NOT NULL
             AND es.start_time < es.end_time
             AND es.shift_date BETWEEN b.start_date AND b.end_date
           UNION ALL
           -- Night shift, pre-midnight leg: [start_time, 24:00)
           SELECT es.shift_date, (EXTRACT(EPOCH FROM es.start_time) / 60)::int, 1440
           FROM employee_schedule es, bounds b
           WHERE es.tenant_id = $1 AND es.is_off = false
             AND es.start_time IS NOT NULL AND es.end_time IS NOT NULL
             AND es.start_time > es.end_time
             AND es.shift_date BETWEEN b.start_date AND b.end_date
           UNION ALL
           -- Night shift, post-midnight leg: [00:00, end_time)
           SELECT es.shift_date, 0, (EXTRACT(EPOCH FROM es.end_time) / 60)::int
           FROM employee_schedule es, bounds b
           WHERE es.tenant_id = $1 AND es.is_off = false
             AND es.start_time IS NOT NULL AND es.end_time IS NOT NULL
             AND es.start_time > es.end_time
             AND es.end_time > '00:00'::time
             AND es.shift_date BETWEEN b.start_date AND b.end_date
         ),
         staffed AS (
           SELECT EXTRACT(DOW FROM seg.shift_date)::int AS dow,
                  h AS hour,
                  SUM(LEAST(seg.m_end, (h + 1) * 60) - GREATEST(seg.m_start, h * 60))::int
                    AS staffed_minutes
           FROM shift_segments seg
           CROSS JOIN LATERAL generate_series(seg.m_start / 60, (seg.m_end - 1) / 60) AS h
           GROUP BY 1, 2
         ),
         -- Occupying appointments as tenant-local timestamps, CLAMPED to the
         -- query window [start_date 00:00, end_date+1 00:00) in tenant-local
         -- time. The clamp (GREATEST against the window start / LEAST against
         -- the window end) stops a boundary-crossing appointment from
         -- bucketing its OUT-of-window minutes onto a day/hour outside the
         -- requested range: e.g. an appointment that starts the evening
         -- BEFORE start_date and spills past midnight into it should
         -- contribute only its in-window minutes, and one that runs past
         -- midnight on end_date must not credit the next (out-of-window) day.
         -- Because the buckets are keyed by weekday+hour, an unclamped
         -- spill-over could land on a same-weekday cell that IS staffed
         -- elsewhere in the window and silently inflate it. The WHERE is an
         -- interval-OVERLAP test (not start-date-in-window) so appointments
         -- that begin before the window but reach into it are included, then
         -- trimmed by the clamp. The LEAST/end side is symmetric to the
         -- GREATEST/start side. Interior cross-midnight minutes still
         -- attribute to the calendar day they fall on (matching how a night
         -- shift's post-midnight leg is credited to that same day).
         appt_intervals AS (
           SELECT GREATEST(a.start_time AT TIME ZONE t.tz, b.start_date::timestamp) AS s,
                  LEAST(a.end_time AT TIME ZONE t.tz, (b.end_date + 1)::timestamp) AS e
           FROM appointments a, tenant_tz t, bounds b
           WHERE a.tenant_id = $1
             AND a.is_deleted = false
             AND a.status IN ('scheduled', 'completed')
             -- Half-open overlap: interval intersects [window_start, window_end).
             AND (a.start_time AT TIME ZONE t.tz) < (b.end_date + 1)::timestamp
             AND (a.end_time AT TIME ZONE t.tz) > b.start_date::timestamp
         ),
         booked AS (
           SELECT EXTRACT(DOW FROM h)::int AS dow,
                  EXTRACT(HOUR FROM h)::int AS hour,
                  ROUND(SUM(EXTRACT(EPOCH FROM
                    (LEAST(i.e, h + interval '1 hour') - GREATEST(i.s, h))) / 60))::int
                    AS booked_minutes
           FROM appt_intervals i
           CROSS JOIN LATERAL generate_series(
             date_trunc('hour', i.s), i.e - interval '1 second', interval '1 hour') AS h
           GROUP BY 1, 2
         )
         SELECT s.dow, s.hour, s.staffed_minutes,
                COALESCE(bk.booked_minutes, 0) AS booked_minutes
         FROM staffed s
         LEFT JOIN booked bk ON bk.dow = s.dow AND bk.hour = s.hour
         ORDER BY s.dow, s.hour`,
    [tenantId, start, end]
  );
  const rows = res.rows;

  const cells = rows.map((r) => ({
    dow: r.dow,
    hour: r.hour,
    staffed_minutes: r.staffed_minutes,
    booked_minutes: r.booked_minutes,
    // Only staffed cells are returned, so staffed_minutes > 0 always holds
    // today — the null branch is a contract guard, not a reachable state.
    utilization: r.staffed_minutes > 0 ? r.booked_minutes / r.staffed_minutes : null,
  }));

  return cells;
}
