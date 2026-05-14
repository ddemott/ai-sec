
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { withHandler, logEvent, requireTenantId, withPoolClient, type AppRequest } from '../middleware';
import { parseDateRange } from './routeHelpers';

export function registerAnalyticsRoutes(
  app: FastifyInstance<any, any, any>,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  // Coverage gap detection — returns per-service coverage status for a date range
  app.get('/coverage', withHandler(async (req: AppRequest, reply) => {
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
  }, 'Failed to check coverage gaps'));

  // GET /coverage/staffing was removed 2026-04-30 along with the
  // employee_shifts table (NEEDS-REFACTORING #4 Phase 2). It joined on
  // weekly patterns to answer "for this day-of-week, who works?" — a
  // question that no longer has a stable answer now that the platform
  // only stores date-specific schedule entries. The dashboard never
  // called it. If we ever need a reframed version it should take a
  // date and read employee_schedule.

  app.get('/call-summaries', withHandler(async (req: AppRequest, reply) => {
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
  }, 'Failed to fetch call summaries'));

  // User feedback — contextual feedback from any page
  app.post('/feedback', withHandler(async (req: AppRequest, reply) => {
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
        [tenantId, userId || null, body.page, body.context || null, body.comment, body.rating || null]
      );
    });

    logEvent(req, 'feedback_submitted', { page: body.page, rating: body.rating });
    return reply.send({ success: true });
  }, 'Failed to submit feedback'));

  // Admin: list all feedback (super-admin sees all tenants, regular user sees own)
  app.get('/feedback', withHandler(async (req: AppRequest, reply) => {
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
  }, 'Failed to fetch feedback'));
}
