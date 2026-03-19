
import type { Pool, PoolClient } from 'pg';

export function registerAnalyticsRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.post('/analytics/stats', async (req, reply) => {
    // Existing analytics logic (placeholder — was empty in original)
  });

  // Coverage gap detection — returns per-service coverage status for a date range
  app.get('/coverage', async (req, reply) => {
    const tenantId = (req.query as any).tenant_id;
    if (!tenantId) {
      return reply.status(400).send({ error: 'tenant_id is required' });
    }

    const startDate = (req.query as any).start_date || new Date().toISOString().split('T')[0];
    const endDate = (req.query as any).end_date || null;

    try {
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
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to check coverage gaps' });
    }
  });

  app.get('/call-summaries', async (req, reply) => {
    const tenantId = (req.query as any).tenant_id;
    const customerId = (req.query as any).customer_id;
    if (!tenantId || !customerId) {
      return reply.status(400).send({ error: 'tenant_id and customer_id are required' });
    }

    try {
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
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch call summaries' });
    }
  });
}
