
import type { Pool, PoolClient } from 'pg';
import { withHandler, requireTenantId, type AppRequest } from '../middleware';

export function registerVocabularyRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  // GET /vocabulary?tenant_id=X - Resolved vocabulary labels (3-tier fallback)
  app.get('/vocabulary', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(`
        SELECT
          COALESCE(t.resource_label, bt.resource_label, 'Resource') AS resource_label,
          COALESCE(t.resource_plural, bt.resource_plural, 'Resources') AS resource_plural,
          COALESCE(t.employee_label, bt.employee_label, 'Employee') AS employee_label,
          COALESCE(t.employee_plural, bt.employee_plural, 'Employees') AS employee_plural,
          COALESCE(t.booking_label, bt.booking_label, 'Appointment') AS booking_label
        FROM tenants t
        LEFT JOIN business_templates bt ON bt.business_type = t.business_type
        WHERE t.id = $1
      `, [tenantId]);
    });

    if (res.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'Tenant not found' });
    }

    return reply.send(res.rows[0]);
  }, 'Failed to fetch vocabulary'));
}
