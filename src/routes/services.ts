
import type { Pool, PoolClient } from 'pg';

export function registerServiceRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get('/services', async (req, reply) => {
    const tenantId = (req.query as any).tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      const res = await withTenantClient(tenantId, async (client) => {
        return client.query('SELECT * FROM services WHERE tenant_id = $1 ORDER BY name ASC', [tenantId]);
      });
      return reply.send(res.rows);
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch services' });
    }
  });

  app.post('/services/create', async (req, reply) => {
    const body = req.body as { tenant_id: string; name: string; description?: string; duration_minutes: number; required_skills?: string[]; required_resources?: string[] };

    try {
      const res = await withTenantClient(body.tenant_id, async (client) => {
        return client.query(
          'INSERT INTO services (tenant_id, name, description, duration_minutes, required_skills, required_resources) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
          [body.tenant_id, body.name, body.description, body.duration_minutes, body.required_skills || [], body.required_resources || []]
        );
      });
      return reply.send({ success: true, service: res.rows[0] });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to create service' });
    }
  });

  app.post('/services/:id/update', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { tenant_id?: string; name?: string; description?: string; duration_minutes?: number; price?: number };
    const tenantId = body.tenant_id || (req as any).auth?.tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          'UPDATE services SET name = COALESCE($1, name), description = COALESCE($2, description), duration_minutes = COALESCE($3, duration_minutes), price = COALESCE($4, price), updated_at = NOW() WHERE id = $5 RETURNING *',
          [body.name, body.description, body.duration_minutes, body.price, id]
        );
      });
      return reply.send({ success: true, service: res.rows[0] });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to update service' });
    }
  });

  app.delete('/services/:id/delete', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = (req.query as any).tenant_id || (req as any).auth?.tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      await withTenantClient(tenantId, async (client) => {
        // Remove mappings first, then delete the service
        await client.query('DELETE FROM service_employee WHERE service_id = $1', [id]);
        await client.query('DELETE FROM service_resource WHERE service_id = $1', [id]);
        await client.query('DELETE FROM services WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
      });
      return reply.send({ success: true });
    } catch (err: any) {
      if (err.statusCode === 400) {
        return reply.status(400).send({ error: err.message });
      }
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to delete service' });
    }
  });
}
