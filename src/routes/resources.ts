
import type { Pool, PoolClient } from 'pg';
import { SUPER_ADMIN_TENANT_ID } from '../constants';
import { withHandler, logEvent, requireTenantId, withPoolClient, type AppRequest } from '../middleware';

export function registerResourceRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get('/resources', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const isSuperAdmin = tenantId === SUPER_ADMIN_TENANT_ID;

    if (isSuperAdmin) {
      return withPoolClient(pool, async (client) => {
        const res = await client.query('SELECT * FROM resources ORDER BY name');
        return reply.send(res.rows);
      });
    }

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query('SELECT * FROM resources WHERE tenant_id = $1 ORDER BY name', [tenantId]);
    });
    return reply.send(res.rows);
  }, 'Failed to fetch resources'));

  app.post('/resources/create', withHandler(async (req: AppRequest, reply) => {
    const body = req.body as { tenant_id: string; name: string; description?: string };
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    if (!body.name) {
      return reply.status(400).send({ success: false, error: 'name is required' });
    }

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        'INSERT INTO resources (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING *',
        [tenantId, body.name, body.description || null]
      );
    });

    logEvent(req, 'resource_created', { resourceId: res.rows[0].id, name: body.name });
    return reply.send({ success: true, resource: res.rows[0] });
  }, 'Failed to create resource'));

  app.post('/resources/:id/update', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { tenant_id?: string; name?: string; description?: string; is_active?: boolean; capabilities?: string[] };
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    await withTenantClient(tenantId, async (client) => {
      const fields: string[] = [];
      const values: unknown[] = [];
      if (body.name !== undefined) { fields.push('name'); values.push(body.name); }
      if (body.description !== undefined) { fields.push('description'); values.push(body.description || null); }
      if (body.is_active !== undefined) { fields.push('is_active'); values.push(body.is_active); }
      if (body.capabilities !== undefined) { fields.push('capabilities'); values.push(body.capabilities); }
      if (fields.length === 0) {
        throw Object.assign(new Error('No updatable fields provided'), { statusCode: 400 });
      }
      const setClause = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
      values.push(id);
      await client.query(`UPDATE resources SET ${setClause} WHERE id = $${values.length}`, values);
    });

    logEvent(req, 'resource_updated', { resourceId: id });
    return reply.send({ success: true });
  }, 'Failed to update resource'));
}
