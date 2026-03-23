
import type { Pool, PoolClient } from 'pg';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';

export function registerServiceRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  // GET /services/catalog?tenant_id=X — public-facing service list for AI callers (Layer 1: database facts)
  app.get('/services/catalog', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        `SELECT id, name, subtitle, description, duration_minutes, price
         FROM services WHERE tenant_id = $1 ORDER BY name ASC`,
        [tenantId]
      );
    });
    return reply.send({ services: res.rows });
  }, 'Failed to fetch service catalog'));

  app.get('/services', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query('SELECT * FROM services WHERE tenant_id = $1 ORDER BY name ASC', [tenantId]);
    });
    return reply.send(res.rows);
  }, 'Failed to fetch services'));

  app.post('/services/create', withHandler(async (req: AppRequest, reply) => {
    const body = req.body as { tenant_id: string; name: string; subtitle?: string; description?: string; duration_minutes: number; required_skills?: string[]; required_resources?: string[] };

    const res = await withTenantClient(body.tenant_id, async (client) => {
      return client.query(
        'INSERT INTO services (tenant_id, name, subtitle, description, duration_minutes, required_skills, required_resources) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [body.tenant_id, body.name, body.subtitle || '', body.description || '', body.duration_minutes, body.required_skills || [], body.required_resources || []]
      );
    });

    logEvent(req, 'service_created', { serviceId: res.rows[0].id, name: body.name });
    return reply.send({ success: true, service: res.rows[0] });
  }, 'Failed to create service'));

  app.post('/services/:id/update', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { tenant_id?: string; name?: string; subtitle?: string; description?: string; duration_minutes?: number; price?: number };
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        'UPDATE services SET name = COALESCE($1, name), subtitle = COALESCE($2, subtitle), description = COALESCE($3, description), duration_minutes = COALESCE($4, duration_minutes), price = COALESCE($5, price), updated_at = NOW() WHERE id = $6 RETURNING *',
        [body.name, body.subtitle, body.description, body.duration_minutes, body.price, id]
      );
    });

    logEvent(req, 'service_updated', { serviceId: id });
    return reply.send({ success: true, service: res.rows[0] });
  }, 'Failed to update service'));

  app.delete('/services/:id/delete', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    await withTenantClient(tenantId, async (client) => {
      // Remove mappings first, then delete the service
      await client.query('DELETE FROM service_employee WHERE service_id = $1', [id]);
      await client.query('DELETE FROM service_resource WHERE service_id = $1', [id]);
      await client.query('DELETE FROM services WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    });

    logEvent(req, 'service_deleted', { serviceId: id });
    return reply.send({ success: true });
  }, 'Failed to delete service'));
}
