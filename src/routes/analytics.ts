import type { AppFastifyInstance } from '../types/fastify';
import type { Pool, PoolClient } from 'pg';
import {
  withHandler,
  logEvent,
  requireTenantId,
  withPoolClient,
  type AppRequest,
} from '../middleware';
import { parseDateRange } from './routeHelpers';

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
             GROUP BY 1
             ORDER BY count DESC`,
            [tenantId]
          ),
          // Per-day call volume over the last 30 days, with booked count.
          client.query<{ day: string; total: number; booked: number }>(
            `SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
                    count(*)::int AS total,
                    count(*) FILTER (WHERE appointment_id IS NOT NULL)::int AS booked
             FROM voice_sessions
             WHERE tenant_id = $1 AND is_deleted = false
               AND started_at >= now() - interval '30 days'
             GROUP BY 1
             ORDER BY 1 ASC`,
            [tenantId]
          ),
          // Top-line totals so the dashboard never has to re-derive the denominator.
          client.query<{ total: number; booked: number; abandoned: number }>(
            `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE appointment_id IS NOT NULL)::int AS booked,
                    count(*) FILTER (WHERE appointment_id IS NULL
                                       AND coalesce(nullif(outcome, ''), 'no_outcome') = 'no_outcome')::int AS abandoned
             FROM voice_sessions
             WHERE tenant_id = $1 AND is_deleted = false`,
            [tenantId]
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
  // by the service the caller was trying to book.
  app.get(
    '/analytics/cohorts',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const data = await withTenantClient(tenantId, async (client) => {
        const [repeatCallers, byService, summary, topCustomers, abandonmentByService] =
          await Promise.all([
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
             GROUP BY 1
             HAVING count(*) > 1
             ORDER BY last_call DESC
             LIMIT 100`,
              [tenantId]
            ),
            // Which services the booked calls actually booked.
            client.query<{ service: string; booked_count: number }>(
              `SELECT coalesce(nullif(s.name, ''), 'Unknown service') AS service,
                    count(*)::int AS booked_count
             FROM voice_sessions v
             JOIN appointments a ON a.appointment_id = v.appointment_id
             LEFT JOIN services s ON s.service_id = a.service_id
             WHERE v.tenant_id = $1 AND v.is_deleted = false
             GROUP BY 1
             ORDER BY booked_count DESC`,
              [tenantId]
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
               GROUP BY 1
             )
             SELECT count(*)::int AS distinct_callers,
                    count(*) FILTER (WHERE c > 1)::int AS repeat_callers,
                    coalesce(sum(c) FILTER (WHERE c > 1), 0)::int AS repeat_call_volume,
                    coalesce(sum(c), 0)::int AS total_calls
             FROM per_caller`,
              [tenantId]
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
             GROUP BY c.customer_id, c.name
             ORDER BY revenue DESC, visits DESC
             LIMIT 20`,
              [tenantId]
            ),
            // Abandonment-by-service: calls that did NOT book (appointment_id NULL)
            // but recorded a requested_service_id (the caller tried to book that
            // service). Surfaces "what are we losing callers over". Depends on the
            // book-with-scheduling capture writing requested_service_id.
            client.query<{ service: string; abandoned_count: number }>(
              `SELECT coalesce(nullif(s.name, ''), 'Unknown service') AS service,
                    count(*)::int AS abandoned_count
             FROM voice_sessions v
             JOIN services s ON s.service_id = v.requested_service_id
             WHERE v.tenant_id = $1 AND v.is_deleted = false
               AND v.appointment_id IS NULL
             GROUP BY 1
             ORDER BY abandoned_count DESC`,
              [tenantId]
            ),
          ]);

        return {
          repeat_callers: repeatCallers.rows,
          by_service: byService.rows,
          top_customers: topCustomers.rows,
          abandonment_by_service: abandonmentByService.rows,
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
