
import type { Pool, PoolClient } from 'pg';
import { withHandler, logEvent, requireTenantId, withPoolClient, type AppRequest } from '../middleware';

export function registerAnalyticsRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.post('/analytics/stats', withHandler(async (_req: AppRequest, _reply) => {
    // Existing analytics logic (placeholder — was empty in original)
  }, 'Failed to fetch analytics stats'));

  // Coverage gap detection — returns per-service coverage status for a date range
  app.get('/coverage', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const startDate = (req.query as any).start_date || new Date().toISOString().split('T')[0];
    const endDate = (req.query as any).end_date || null;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        `SELECT service_id, service_name, duration_minutes, coverage_status,
                total_open_hours, covered_hours, gap_hours,
                has_qualified_staff, has_capable_resource,
                qualified_employee_count, capable_resource_count,
                gap_details
         FROM check_coverage_gaps($1, $2::DATE, $3::DATE)`,
        [tenantId, startDate, endDate]
      );
    });
    return reply.send(res.rows);
  }, 'Failed to check coverage gaps'));

  // Service staffing map — per-service employee availability for a given day of week
  app.get('/coverage/staffing', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const dayOfWeek = parseInt((req.query as Record<string, string>).day_of_week || String(new Date().getDay()), 10);

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(`
        SELECT
          s.id as service_id,
          s.name as service_name,
          s.duration_minutes,
          e.id as employee_id,
          e.name as employee_name,
          es.start_time::text as shift_start,
          es.end_time::text as shift_end
        FROM services s
        LEFT JOIN service_employee se ON se.service_id = s.id AND se.tenant_id = s.tenant_id
        LEFT JOIN employees e ON e.id = se.employee_id AND e.is_deleted = false
        LEFT JOIN employee_shifts es ON es.employee_id = e.id AND es.tenant_id = s.tenant_id
          AND es.day_of_week = $2 AND es.is_active = true
        WHERE s.tenant_id = $1
        ORDER BY s.name, e.name
      `, [tenantId, dayOfWeek]);
    });

    // Group by service with employee shift details
    const serviceMap = new Map<string, {
      service_id: string;
      service_name: string;
      duration_minutes: number;
      employees: { id: string; name: string; shift_start: string | null; shift_end: string | null }[];
    }>();

    for (const row of res.rows) {
      if (!serviceMap.has(row.service_id)) {
        serviceMap.set(row.service_id, {
          service_id: row.service_id,
          service_name: row.service_name,
          duration_minutes: row.duration_minutes,
          employees: [],
        });
      }
      const svc = serviceMap.get(row.service_id)!;
      if (row.employee_id && row.shift_start) {
        if (!svc.employees.some(e => e.id === row.employee_id && e.shift_start === row.shift_start)) {
          svc.employees.push({
            id: row.employee_id,
            name: row.employee_name,
            shift_start: row.shift_start,
            shift_end: row.shift_end,
          });
        }
      }
    }

    return reply.send(Array.from(serviceMap.values()));
  }, 'Failed to fetch staffing map'));

  app.get('/call-summaries', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const customerId = (req.query as any).customer_id;
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
           LEFT JOIN users u ON u.id = f.user_id
           LEFT JOIN tenants t ON t.id = f.tenant_id
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
         LEFT JOIN users u ON u.id = f.user_id
         WHERE f.tenant_id = $1
         ORDER BY f.created_at DESC
         LIMIT 100`,
        [tenantId]
      );
    });
    return reply.send(res.rows);
  }, 'Failed to fetch feedback'));
}
