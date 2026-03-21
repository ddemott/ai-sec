
import type { Pool, PoolClient } from 'pg';
import { SUPER_ADMIN_TENANT_ID } from '../constants';

export function registerResourceRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get('/resources', async (req, reply) => {
    const tenantId = (req.query as any)['tenant_id'];
    const isSuperAdmin = tenantId === SUPER_ADMIN_TENANT_ID;

    try {
      if (isSuperAdmin) {
        const client = await pool.connect();
        try {
          const res = await client.query('SELECT * FROM resources ORDER BY name');
          return reply.send(res.rows);
        } finally {
          client.release();
        }
      } else {
        const res = await withTenantClient(tenantId, async (client) => {
          return client.query('SELECT * FROM resources WHERE tenant_id = $1 ORDER BY name', [tenantId]);
        });
        return reply.send(res.rows);
      }
    } catch (err) {
      if (err instanceof Error && (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND') throw err;
      return reply.status(500).send({ error: 'Failed to fetch resources' });
    }
  });

  app.post('/resources/create', async (req, reply) => {
    const body = req.body as { tenant_id: string; name: string; description?: string };
    if (!body.tenant_id || !body.name) {
      return reply.status(400).send({ success: false, error: 'tenant_id and name are required' });
    }

    try {
      const res = await withTenantClient(body.tenant_id, async (client) => {
        return client.query(
          'INSERT INTO resources (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING *',
          [body.tenant_id, body.name, body.description || null]
        );
      });
      return reply.send({ success: true, resource: res.rows[0] });
    } catch (err) {
      if (err instanceof Error && (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND') throw err;
      app.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to create resource' });
    }
  });

  app.post('/resources/:id/update', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { tenant_id?: string; name?: string; description?: string; is_active?: boolean; capabilities?: string[] };
    const tenantId = body.tenant_id || (req as any).auth?.tenant_id;
    if (!tenantId) return reply.status(400).send({ success: false, error: 'tenant_id is required' });

    try {
      await withTenantClient(tenantId, async (client) => {
        const fields: string[] = [];
        const values: any[] = [];
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
      return reply.send({ success: true });
    } catch (err: any) {
      if (err instanceof Error && (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND') throw err;
      if (err.statusCode === 400) {
        return reply.status(400).send({ success: false, error: err.message });
      }
      app.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to update resource' });
    }
  });
}
