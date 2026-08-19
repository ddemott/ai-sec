import type { AppFastifyInstance } from '../types/fastify';
import type { Pool, PoolClient } from 'pg';
import {
  withHandler,
  logEvent,
  requireTenantId,
  withPoolClient,
  type AppRequest,
} from '../middleware/fastify-middleware';
import { parseDateRange } from './routeHelpers';
import { z } from 'zod';
import {
  DraftGraphSchema,
  findDuplicateTmpIds,
  findMissingTmpIdReferences,
  weeksAheadFor,
  insertDraftGraph,
} from '../services/setupGraph';

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// One row of check_coverage_gaps output (per service, per date in the window).
interface CoverageGapRow {
  service_id: string;
  service_name: string;
  check_date: string;
  gap_hours: number[] | null;
  covered_hours: number[] | null;
  total_open_hours: number;
  coverage_pct: string | number;
  status: string;
  details: Record<string, unknown> | null;
}

// Draft graph posted by the setup wizard (Phase B) to preview coverage BEFORE
// anything is persisted. Shares DraftGraphSchema with POST /setup/commit
// (src/routes/setup.ts) — see src/services/setupGraph.ts module doc. Every
// entity carries a client-side `tmp_id` so mappings + shifts can reference
// each other without real DB ids.
const CoverageDryRunSchema = DraftGraphSchema.extend({
  // refine (not just regex): reject calendar-invalid but well-shaped dates like
  // 2026-02-30 here, so they never reach a `$n::date` cast (→ 500).
  start_date: z
    .string()
    .refine(isValidDateOnly, 'start_date must be a real YYYY-MM-DD date')
    .optional(),
  end_date: z
    .string()
    .refine(isValidDateOnly, 'end_date must be a real YYYY-MM-DD date')
    .optional(),
});

/**
 * True only for a real calendar date in YYYY-MM-DD form. The regex alone is not
 * enough: "2026-02-30" and "2026-13-01" are correctly *shaped* but not real
 * dates, and would pass straight through to a `$n::date` cast and throw a 500.
 * We round-trip through a UTC Date and require every component to survive, so a
 * calendar-invalid bound is rejected here (→ null → all-time), never at the DB.
 */
function isValidDateOnly(s: string): boolean {
  const m = DATE_ONLY_RE.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

/**
 * Optional, unbounded-by-default date window for the analytics endpoints.
 * Unlike parseDateRange (which defaults the start to *today* — right for a
 * coverage lookup, wrong for analytics where "no filter" means all-time), this
 * returns null for any missing/malformed/calendar-invalid bound. Callers pass
 * [tenantId, start, end] and guard each side with `($n::date IS NULL OR col >=
 * $n::date)` so an absent bound drops out of the predicate entirely. `end` is
 * treated as inclusive of the whole day via `< $end::date + interval '1 day'`.
 */
function optionalDateBounds(query: Record<string, string>): {
  start: string | null;
  end: string | null;
} {
  const start = query.start_date && isValidDateOnly(query.start_date) ? query.start_date : null;
  const end = query.end_date && isValidDateOnly(query.end_date) ? query.end_date : null;
  return { start, end };
}

export function registerAnalyticsRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  // Top-line stats for the dashboard Home + Analytics views. Returns the
  // AnalyticsStats shape (dashboard/lib/types.ts) directly (not the
  // {success,result} envelope) — apiFetch<AnalyticsStats> consumes it raw.
  // Registered at the full path '/analytics/stats' because these analytics
  // routes are mounted without an '/analytics' prefix (coverage/feedback are
  // root-level), but the dashboard calls '/analytics/stats'.
  app.get(
    '/analytics/stats',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const stats = await withTenantClient(tenantId, async (client) => {
        const [calls, appts, custs, activity] = await Promise.all([
          client.query<{ total: number; today: number; week: number }>(
            `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE started_at >= date_trunc('day', now()))::int AS today,
                    count(*) FILTER (WHERE started_at >= now() - interval '7 days')::int AS week
             FROM voice_sessions WHERE tenant_id = $1 AND is_deleted = false`,
            [tenantId]
          ),
          client.query<{ total: number; today: number; week: number; upcoming: number }>(
            `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE start_time >= date_trunc('day', now())
                                       AND start_time < date_trunc('day', now()) + interval '1 day')::int AS today,
                    count(*) FILTER (WHERE start_time >= now() - interval '7 days')::int AS week,
                    count(*) FILTER (WHERE start_time >= now())::int AS upcoming
             FROM appointments WHERE tenant_id = $1 AND is_deleted = false`,
            [tenantId]
          ),
          client.query<{ total: number; new_this_week: number }>(
            `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS new_this_week
             FROM customers WHERE tenant_id = $1 AND is_deleted = false`,
            [tenantId]
          ),
          client.query<{ type: string; description: string; timestamp: string }>(
            `(SELECT 'appointment' AS type,
                     'Appointment booked: ' || coalesce(description, 'appointment') AS description,
                     created_at AS timestamp
              FROM appointments WHERE tenant_id = $1 AND is_deleted = false
              ORDER BY created_at DESC LIMIT 10)
             UNION ALL
             (SELECT 'call', 'Call from ' || coalesce(caller_phone, 'unknown'), created_at
              FROM voice_sessions WHERE tenant_id = $1 AND is_deleted = false
              ORDER BY created_at DESC LIMIT 10)
             UNION ALL
             (SELECT 'customer', 'New customer: ' || coalesce(name, 'unknown'), created_at
              FROM customers WHERE tenant_id = $1 AND is_deleted = false
              ORDER BY created_at DESC LIMIT 10)
             ORDER BY timestamp DESC LIMIT 15`,
            [tenantId]
          ),
        ]);

        return {
          calls: calls.rows[0] ?? { total: 0, today: 0, week: 0 },
          appointments: appts.rows[0] ?? { total: 0, today: 0, week: 0, upcoming: 0 },
          customers: custs.rows[0] ?? { total: 0, new_this_week: 0 },
          recent_activity: activity.rows,
        };
      });

      return reply.send(stats);
    }, 'Failed to load analytics stats')
  );

  // Call-analytics cut for the Analytics view: outcome breakdown (the "why")
  // + per-day call volume with a booked count. Built entirely from
  // voice_sessions — "booked" is keyed on appointment_id IS NOT NULL (the hard
  // signal), NOT the freeform `outcome` text. The dashboard derives conversion
  // (booked/total), abandonment (no_outcome share) and the volume sparkline
  // from these two arrays. Returns the AnalyticsCalls shape directly (raw, no
  // {success,result} envelope) like /analytics/stats above.
  app.get(
    '/analytics/calls',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      // Optional From/To window (YYYY-MM-DD). Absent → all-time. `end` is
      // inclusive of the whole day. byDay keeps its 30-day default ONLY when no
      // start is supplied, so the sparkline isn't blank on first load.
      const { start, end } = optionalDateBounds(req.query as Record<string, string>);

      const data = await withTenantClient(tenantId, async (client) => {
        const [byOutcome, byDay, totals] = await Promise.all([
          // Outcome breakdown — powers Conversion, Abandonment, and the WHY cut.
          // NULL/empty outcome collapses to 'no_outcome' (an abandoned/unclassified call).
          client.query<{ outcome: string; count: number; booked: number }>(
            `SELECT coalesce(nullif(outcome, ''), 'no_outcome') AS outcome,
                    count(*)::int AS count,
                    count(*) FILTER (WHERE appointment_id IS NOT NULL)::int AS booked
             FROM voice_sessions
             WHERE tenant_id = $1 AND is_deleted = false
               AND ($2::date IS NULL OR started_at >= $2::date)
               AND ($3::date IS NULL OR started_at < ($3::date + interval '1 day'))
             GROUP BY 1
             ORDER BY count DESC`,
            [tenantId, start, end]
          ),
          // Per-day call volume, with booked count. Lower bound: the supplied
          // start, else the last 30 days. Upper bound: the supplied end (inclusive).
          client.query<{ day: string; total: number; booked: number }>(
            `SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
                    count(*)::int AS total,
                    count(*) FILTER (WHERE appointment_id IS NOT NULL)::int AS booked
             FROM voice_sessions
             WHERE tenant_id = $1 AND is_deleted = false
               AND started_at >= COALESCE($2::date, (now() - interval '30 days'))
               AND ($3::date IS NULL OR started_at < ($3::date + interval '1 day'))
             GROUP BY 1
             ORDER BY 1 ASC`,
            [tenantId, start, end]
          ),
          // Top-line totals so the dashboard never has to re-derive the denominator.
          client.query<{ total: number; booked: number; abandoned: number }>(
            `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE appointment_id IS NOT NULL)::int AS booked,
                    count(*) FILTER (WHERE appointment_id IS NULL
                                       AND coalesce(nullif(outcome, ''), 'no_outcome') = 'no_outcome')::int AS abandoned
             FROM voice_sessions
             WHERE tenant_id = $1 AND is_deleted = false
               AND ($2::date IS NULL OR started_at >= $2::date)
               AND ($3::date IS NULL OR started_at < ($3::date + interval '1 day'))`,
            [tenantId, start, end]
          ),
        ]);

        return {
          totals: totals.rows[0] ?? { total: 0, booked: 0, abandoned: 0 },
          by_outcome: byOutcome.rows,
          by_day: byDay.rows,
        };
      });

      return reply.send(data);
    }, 'Failed to load call analytics')
  );

  // Analytics depth: repeat-caller cohorts + bookings-by-service. Both are
  // derivable from voice_sessions today (no new column). Repeat callers are
  // grouped on the LAST 10 DIGITS of caller_phone (US-centric) so the same
  // person reaching out as "+16305559999" (E.164, with the 1 country code) and
  // "630-555-9999" (10-digit) counts once. Bookings-by-service joins booked
  // calls → appointment → service. CLV (top_customers) ranks customers by
  // lifetime booked revenue. Abandonment-by-service uses
  // voice_sessions.requested_service_id (set best-effort by the
  // book-with-scheduling agent tool) to group abandoned calls (no appointment)
  // by the service the caller was trying to book. First-time-fix
  // (first_time_fix) reports the share of distinct callers whose first call
  // ended in a booking — "resolved on first contact".
  app.get(
    '/analytics/cohorts',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      // Optional From/To window (YYYY-MM-DD). Absent → all-time. `end` is
      // inclusive of the whole day. Voice queries filter on started_at; the
      // revenue (top-customers) query filters on the appointment's start_time.
      const { start, end } = optionalDateBounds(req.query as Record<string, string>);

      const data = await withTenantClient(tenantId, async (client) => {
        const [
          repeatCallers,
          byService,
          summary,
          topCustomers,
          abandonmentByService,
          firstTimeFix,
        ] = await Promise.all([
          // Callers who reached out more than once, newest-activity first.
          client.query<{
            phone: string;
            call_count: number;
            booked_count: number;
            first_call: string;
            last_call: string;
          }>(
            `SELECT right(regexp_replace(caller_phone, '[^0-9]', '', 'g'), 10) AS phone,
                    count(*)::int AS call_count,
                    count(*) FILTER (WHERE appointment_id IS NOT NULL)::int AS booked_count,
                    min(started_at) AS first_call,
                    max(started_at) AS last_call
             FROM voice_sessions
             WHERE tenant_id = $1 AND is_deleted = false
               AND right(regexp_replace(caller_phone, '[^0-9]', '', 'g'), 10) <> ''
               AND ($2::date IS NULL OR started_at >= $2::date)
               AND ($3::date IS NULL OR started_at < ($3::date + interval '1 day'))
             GROUP BY 1
             HAVING count(*) > 1
             ORDER BY last_call DESC
             LIMIT 100`,
            [tenantId, start, end]
          ),
          // Which services the booked calls actually booked.
          client.query<{ service: string; booked_count: number }>(
            `SELECT coalesce(nullif(s.name, ''), 'Unknown service') AS service,
                    count(*)::int AS booked_count
             FROM voice_sessions v
             JOIN appointments a ON a.appointment_id = v.appointment_id
             LEFT JOIN services s ON s.service_id = a.service_id
             WHERE v.tenant_id = $1 AND v.is_deleted = false
               AND ($2::date IS NULL OR v.started_at >= $2::date)
               AND ($3::date IS NULL OR v.started_at < ($3::date + interval '1 day'))
             GROUP BY 1
             ORDER BY booked_count DESC`,
            [tenantId, start, end]
          ),
          // Top-line: how many distinct callers, how many are repeat, and how
          // much of total call volume comes from repeat callers.
          client.query<{
            distinct_callers: number;
            repeat_callers: number;
            repeat_call_volume: number;
            total_calls: number;
          }>(
            `WITH per_caller AS (
               SELECT right(regexp_replace(caller_phone, '[^0-9]', '', 'g'), 10) AS phone,
                      count(*)::int AS c
               FROM voice_sessions
               WHERE tenant_id = $1 AND is_deleted = false
                 AND right(regexp_replace(caller_phone, '[^0-9]', '', 'g'), 10) <> ''
                 AND ($2::date IS NULL OR started_at >= $2::date)
                 AND ($3::date IS NULL OR started_at < ($3::date + interval '1 day'))
               GROUP BY 1
             )
             SELECT count(*)::int AS distinct_callers,
                    count(*) FILTER (WHERE c > 1)::int AS repeat_callers,
                    coalesce(sum(c) FILTER (WHERE c > 1), 0)::int AS repeat_call_volume,
                    coalesce(sum(c), 0)::int AS total_calls
             FROM per_caller`,
            [tenantId, start, end]
          ),
          // Customer lifetime value: top customers by total booked revenue
          // (sum of each appointment's service price). services.price defaults
          // to 0, so a tenant that hasn't priced services sees visits with $0 —
          // still a useful "who books most" ranking. ::float8 so JSON gets a
          // number, not a Postgres numeric string.
          client.query<{
            customer_id: string;
            name: string;
            visits: number;
            revenue: number;
          }>(
            `SELECT c.customer_id,
                    coalesce(nullif(c.name, ''), 'Unknown') AS name,
                    count(a.appointment_id)::int AS visits,
                    coalesce(sum(s.price), 0)::float8 AS revenue
             FROM appointments a
             JOIN customers c ON c.customer_id = a.customer_id
             LEFT JOIN services s ON s.service_id = a.service_id
             WHERE a.tenant_id = $1 AND a.is_deleted = false AND c.is_deleted = false
               AND ($2::date IS NULL OR a.start_time >= $2::date)
               AND ($3::date IS NULL OR a.start_time < ($3::date + interval '1 day'))
             GROUP BY c.customer_id, c.name
             ORDER BY revenue DESC, visits DESC
             LIMIT 20`,
            [tenantId, start, end]
          ),
          // Abandonment-by-service: calls that did NOT book (appointment_id NULL)
          // but recorded a requested_service_id (the caller tried to book that
          // service). Surfaces "what are we losing callers over". Depends on the
          // book-with-scheduling capture writing requested_service_id.
          //
          // FORWARD-COMPATIBLE: this is the ONLY query that reads the
          // voice_sessions.requested_service_id column added by migration
          // 20260622010000. If a deploy lands before that migration is applied
          // (as happened on prod), the column is missing and this query throws
          // — which, inside the Promise.all, would reject the WHOLE /analytics/
          // cohorts endpoint (500 on every Analytics-tab load). The .catch
          // degrades just this one panel to empty so the rest of the cohort
          // data still renders. Once the migration is applied it returns real
          // rows. (Same "safe pre-migration" stance as the audit-extend work.)
          client
            .query<{ service: string; abandoned_count: number }>(
              `SELECT coalesce(nullif(s.name, ''), 'Unknown service') AS service,
                    count(*)::int AS abandoned_count
             FROM voice_sessions v
             JOIN services s ON s.service_id = v.requested_service_id
             WHERE v.tenant_id = $1 AND v.is_deleted = false
               AND v.appointment_id IS NULL
               AND ($2::date IS NULL OR v.started_at >= $2::date)
               AND ($3::date IS NULL OR v.started_at < ($3::date + interval '1 day'))
             GROUP BY 1
             ORDER BY abandoned_count DESC`,
              [tenantId, start, end]
            )
            .catch((err: unknown) => {
              // Degrade ONLY for "column does not exist" (Postgres 42703) — the
              // pre-migration window where requested_service_id isn't there yet.
              // Any other failure (permissions, outage, syntax) must surface as a
              // real error via withHandler, not hide behind an empty panel.
              if (err && typeof err === 'object' && (err as { code?: string }).code === '42703') {
                return { rows: [] as { service: string; abandoned_count: number }[] };
              }
              throw err;
            }),
          // First-time-fix rate: of distinct callers (same last-10-digit phone
          // key as the other cohort cuts; NULL/empty phones excluded), how many
          // had their FIRST call end in a booking — "resolved on first contact".
          // "Booked" is the hard signal (appointment_id IS NOT NULL) OR the
          // agent's 'booked' outcome text, so a booking whose call→appointment
          // link failed to persist still counts. The From/To window bounds the
          // calls considered (same $2/$3 guards as abandonment_by_service), so
          // the "first" call is the earliest one WITHIN the window — consistent
          // with how the summary CTE treats the range. DISTINCT ON + ORDER BY
          // started_at picks each caller's earliest in-window call.
          client.query<{ distinct_callers: number; first_call_booked: number }>(
            `WITH first_calls AS (
               SELECT DISTINCT ON (right(regexp_replace(caller_phone, '[^0-9]', '', 'g'), 10))
                      (appointment_id IS NOT NULL OR outcome = 'booked') AS first_booked
               FROM voice_sessions
               WHERE tenant_id = $1 AND is_deleted = false
                 AND right(regexp_replace(caller_phone, '[^0-9]', '', 'g'), 10) <> ''
                 AND ($2::date IS NULL OR started_at >= $2::date)
                 AND ($3::date IS NULL OR started_at < ($3::date + interval '1 day'))
               ORDER BY right(regexp_replace(caller_phone, '[^0-9]', '', 'g'), 10),
                        started_at ASC
             )
             SELECT count(*)::int AS distinct_callers,
                    count(*) FILTER (WHERE first_booked)::int AS first_call_booked
             FROM first_calls`,
            [tenantId, start, end]
          ),
        ]);

        // rate is null (not 0) when there are no callers — "no data" and
        // "0% first-call bookings" are different facts and must render apart.
        const ftf = firstTimeFix.rows[0] ?? { distinct_callers: 0, first_call_booked: 0 };
        return {
          repeat_callers: repeatCallers.rows,
          by_service: byService.rows,
          top_customers: topCustomers.rows,
          abandonment_by_service: abandonmentByService.rows,
          first_time_fix: {
            rate: ftf.distinct_callers > 0 ? ftf.first_call_booked / ftf.distinct_callers : null,
            first_call_booked: ftf.first_call_booked,
            distinct_callers: ftf.distinct_callers,
          },
          summary: summary.rows[0] ?? {
            distinct_callers: 0,
            repeat_callers: 0,
            repeat_call_volume: 0,
            total_calls: 0,
          },
        };
      });

      logEvent(req, 'analytics_cohorts_viewed', { tenantId });
      return reply.send(data);
    }, 'Failed to load cohort analytics')
  );

  // Utilization heatmap (GAPS §6) — weekday × hour grid of staffed capacity vs
  // booked time, powering the dashboard's Utilization panel. For each
  // (dow 0-6, hour 0-23) cell that has ANY staffed capacity in the window:
  //   staffed_minutes — summed employee-minutes from employee_schedule shifts
  //                     (is_off = false) overlapping that hour-of-day
  //   booked_minutes  — summed appointment-minutes overlapping that hour.
  //                     Occupancy statuses: 'scheduled' (the only status the
  //                     booking RPCs treat as blocking a slot) plus 'completed'
  //                     (past appointments that DID consume staffed time —
  //                     excluding them would make history look artificially
  //                     open). 'canceled' and soft-deleted rows are excluded,
  //                     matching the RPCs' occupancy predicate.
  // Hours with zero staffed capacity are omitted (utilization is undefined
  // there — the UI renders them as unstaffed, not as 0%).
  //
  // Cross-midnight night shifts (start_time > end_time) follow the
  // book_with_scheduling_atomic() semantics (see the night-shift OR-branch in
  // 20260430000002_drop_employee_shifts.sql): a row dated D covers day D's
  // wrap-around window — [00:00, end_time) and [start_time, 24:00) — because a
  // 1am booking on day D is validated against day D's night-shift row (the RPC
  // matches shift_date = the booking's local date, then
  // `v_start_tod >= start OR v_end_tod <= end`). So the night shift is split
  // into those two same-day segments, both attributed to D's weekday.
  //
  // All times are tenant-local (tenants.timezone, like the booking RPCs):
  // shift times are already local; appointment timestamptz values are
  // converted via AT TIME ZONE before bucketing, so "Tuesday 2pm" means the
  // tenant's 2pm. Optional From/To window via optionalDateBounds (same
  // contract as /analytics/calls + /analytics/cohorts); absent bounds default
  // to the LAST 28 DAYS (not all-time — four full weeks keeps every weekday
  // equally represented so no day looks artificially busy).
  app.get(
    '/analytics/utilization',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const { start, end } = optionalDateBounds(req.query as Record<string, string>);

      const rows = await withTenantClient(tenantId, async (client) => {
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
        return res.rows;
      });

      const cells = rows.map((r) => ({
        dow: r.dow,
        hour: r.hour,
        staffed_minutes: r.staffed_minutes,
        booked_minutes: r.booked_minutes,
        // Only staffed cells are returned, so staffed_minutes > 0 always holds
        // today — the null branch is a contract guard, not a reachable state.
        utilization: r.staffed_minutes > 0 ? r.booked_minutes / r.staffed_minutes : null,
      }));

      logEvent(req, 'analytics_utilization_viewed', { tenantId });
      return reply.send({ cells });
    }, 'Failed to load utilization analytics')
  );

  // Coverage gap detection — returns per-service coverage status for a date range
  app.get(
    '/coverage',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const { startDate, endDate } = parseDateRange(req.query as Record<string, string>);

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          `SELECT service_id, service_name, check_date, gap_hours, covered_hours,
                total_open_hours, coverage_pct, status, details
         FROM check_coverage_gaps($1, $2::DATE, $3::DATE)`,
          [tenantId, startDate, endDate]
        );
      });
      return reply.send(res.rows);
    }, 'Failed to check coverage gaps')
  );

  // POST /coverage/dry-run — coverage for a DRAFT graph that isn't in the DB yet
  // (setup-wizard Phase B holds services/employees/shifts/mappings in local state
  // and commits only on Done). We reuse the real check_coverage_gaps RPC as the
  // single source of truth by inserting the draft inside a transaction, running
  // the RPC, and ALWAYS rolling back — nothing is ever persisted. Coverage rows
  // come back keyed on the ephemeral service_id created here, so the client
  // matches them to its draft services by NAME.
  app.post(
    '/coverage/dry-run',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const parsed = CoverageDryRunSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }
      const draft = parsed.data;
      const startDate = draft.start_date ?? new Date().toISOString().split('T')[0];
      // Coverage needs a BOUNDED window — check_coverage_gaps runs
      // generate_series(start, end), and generate_series(start, NULL) yields no
      // rows (→ empty coverage). Default to a 4-week horizon (matches the
      // wizard's forward-schedule expansion) when the caller gives no end.
      const endDate =
        draft.end_date ??
        new Date(Date.parse(`${startDate}T00:00:00Z`) + 27 * 86_400_000)
          .toISOString()
          .split('T')[0];

      // A window where end < start makes generate_series() return no rows and
      // would silently report "no gaps" — reject it instead of misleading.
      if (endDate < startDate) {
        return reply
          .status(400)
          .send({ success: false, error: 'end_date must be on or after start_date' });
      }

      // Fail fast on a broken draft graph: a shift or mapping that references a
      // tmp_id not present in the entity lists is a client bug, and silently
      // dropping it would produce a misleading coverage preview.
      const duplicates = findDuplicateTmpIds(draft);
      if (duplicates.length > 0) {
        return reply.status(400).send({
          success: false,
          error: 'Draft contains duplicate tmp_ids',
          details: duplicates,
        });
      }

      const missing = findMissingTmpIdReferences(draft);
      if (missing.length > 0) {
        return reply.status(400).send({
          success: false,
          error: 'Draft references unknown tmp_ids',
          details: missing,
        });
      }

      const weeksAhead = weeksAheadFor(startDate, endDate);

      const rows = await withTenantClient(tenantId, async (client) => {
        await client.query('BEGIN');
        try {
          // insertDraftGraph writes the FULL column set it's given (description/
          // price/contact fields included) — dry-run just never sends them, since
          // a coverage preview doesn't need them and everything rolls back anyway.
          await insertDraftGraph(client, tenantId, draft, {
            weeksAhead,
            startDate: new Date(`${startDate}T00:00:00Z`),
          });

          const res = await client.query<CoverageGapRow>(
            `SELECT service_id, service_name, check_date, gap_hours, covered_hours,
                    total_open_hours, coverage_pct, status, details
             FROM check_coverage_gaps($1, $2::DATE, $3::DATE)`,
            [tenantId, startDate, endDate]
          );
          return res.rows;
        } finally {
          // Never persist the draft — this is a preview. ROLLBACK runs on both the
          // success and error paths (the rows are already materialized in JS).
          await client.query('ROLLBACK');
        }
      });

      logEvent(req, 'coverage_dry_run', {
        services: draft.services.length,
        employees: draft.employees.length,
        shifts: draft.shifts.length,
      });
      return reply.send(rows);
    }, 'Failed to preview coverage')
  );

  // GET /coverage/staffing was removed 2026-04-30 along with the
  // employee_shifts table (historical major refactor; see RESOLVED.md, originally tracked as NEEDS-REFACTORING #4 Phase 2). It joined on
  // weekly patterns to answer "for this day-of-week, who works?" — a
  // question that no longer has a stable answer now that the platform
  // only stores date-specific schedule entries. The dashboard never
  // called it. If we ever need a reframed version it should take a
  // date and read employee_schedule.

  app.get(
    '/call-summaries',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      const customerId = (req.query as { customer_id?: string }).customer_id;
      if (!customerId) {
        return reply.status(400).send({ success: false, error: 'customer_id is required' });
      }

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          `SELECT cs.*, ct.created_at as call_timestamp, ct.raw_text IS NOT NULL as has_transcript
         FROM call_summaries cs
         LEFT JOIN call_transcripts ct ON ct.call_id = cs.call_id
         WHERE cs.tenant_id = $1 AND cs.customer_id = $2
         ORDER BY cs.created_at DESC`,
          [tenantId, customerId]
        );
      });
      return reply.send(res.rows);
    }, 'Failed to fetch call summaries')
  );

  // User feedback — contextual feedback from any page
  app.post(
    '/feedback',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      const userId = req.auth?.user_id;

      const body = req.body as { page: string; context?: string; comment: string; rating?: number };
      if (!body.page || !body.comment) {
        return reply.status(400).send({ success: false, error: 'page and comment are required' });
      }

      await withTenantClient(tenantId, async (client) => {
        await client.query(
          `INSERT INTO user_feedback (tenant_id, user_id, page, context, comment, rating)
         VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            tenantId,
            userId || null,
            body.page,
            body.context || null,
            body.comment,
            body.rating || null,
          ]
        );
      });

      logEvent(req, 'feedback_submitted', { page: body.page, rating: body.rating });
      return reply.send({ success: true });
    }, 'Failed to submit feedback')
  );

  // Admin: list all feedback (super-admin sees all tenants, regular user sees own)
  app.get(
    '/feedback',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const isSuperAdmin = tenantId === '00000000-0000-0000-0000-000000000000';

      if (isSuperAdmin) {
        // Super admin sees ALL feedback across all tenants
        return withPoolClient(pool, async (client) => {
          const res = await client.query(
            `SELECT f.*, u.full_name as user_name, t.name as tenant_name
           FROM user_feedback f
           LEFT JOIN users u ON u.user_id = f.user_id
           LEFT JOIN tenants t ON t.tenant_id = f.tenant_id
           ORDER BY f.created_at DESC
           LIMIT 200`
          );
          return reply.send(res.rows);
        });
      }

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          `SELECT f.*, u.full_name as user_name
         FROM user_feedback f
         LEFT JOIN users u ON u.user_id = f.user_id
         WHERE f.tenant_id = $1
         ORDER BY f.created_at DESC
         LIMIT 100`,
          [tenantId]
        );
      });
      return reply.send(res.rows);
    }, 'Failed to fetch feedback')
  );

  // GET /analytics/ai-cost — month-to-date AI usage aggregated by provider + model.
  app.get(
    '/analytics/ai-cost',
    withHandler(async (req, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query<{
          source: string;
          provider: string;
          model: string;
          input_tokens: string;
          output_tokens: string;
          characters_count: string;
          audio_duration_ms: string;
          estimated_cost_usd: string;
        }>(
          `SELECT
             source,
             provider,
             model,
             SUM(input_tokens)::bigint        AS input_tokens,
             SUM(output_tokens)::bigint       AS output_tokens,
             SUM(characters_count)::bigint    AS characters_count,
             SUM(audio_duration_ms)::bigint   AS audio_duration_ms,
             SUM(estimated_cost_usd)          AS estimated_cost_usd
           FROM ai_cost_events
           WHERE tenant_id = $1
             AND created_at >= date_trunc('month', now())
           GROUP BY source, provider, model
           ORDER BY SUM(estimated_cost_usd) DESC`,
          [tenantId]
        );
      });

      const breakdown = res.rows.map((r) => ({
        source: r.source,
        provider: r.provider,
        model: r.model,
        input_tokens: Number(r.input_tokens),
        output_tokens: Number(r.output_tokens),
        characters_count: Number(r.characters_count),
        audio_duration_ms: Number(r.audio_duration_ms),
        estimated_cost_usd: Number(r.estimated_cost_usd),
      }));

      const total_estimated_cost_usd = breakdown.reduce((sum, r) => sum + r.estimated_cost_usd, 0);

      return reply.send({ breakdown, total_estimated_cost_usd });
    }, 'Failed to load AI cost data')
  );
}
