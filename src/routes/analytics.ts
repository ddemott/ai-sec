
import type { Pool, PoolClient } from 'pg';

export function registerAnalyticsRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.post('/analytics/stats', async (req, reply) => {
    // Existing analytics logic (placeholder — was empty in original)
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
          'SELECT * FROM call_summaries WHERE tenant_id = $1 AND customer_id = $2 ORDER BY created_at DESC',
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
