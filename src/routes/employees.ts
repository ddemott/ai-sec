
import type { Pool, PoolClient } from 'pg';

export function registerEmployeeRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get('/employees', async (req, reply) => {
    const tenantId = (req.query as any).tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(`
          SELECT id::text, name, skills, is_active, 'employee' as type
          FROM employees WHERE tenant_id = $1
          UNION ALL
          SELECT id::text, COALESCE(full_name, email) as name, '{}'::text[] as skills, true as is_active, 'user' as type
          FROM users WHERE tenant_id = $1
          ORDER BY name ASC
        `, [tenantId]);
      });
      return reply.send(res.rows);
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch employees' });
    }
  });

  app.post('/employees/create', async (req, reply) => {
    const body = req.body as { tenant_id: string; name: string; skills?: string[] };

    try {
      const res = await withTenantClient(body.tenant_id, async (client) => {
        return client.query(
          'INSERT INTO employees (tenant_id, name, skills) VALUES ($1, $2, $3) RETURNING *',
          [body.tenant_id, body.name, body.skills || []]
        );
      });
      return reply.send({ success: true, employee: res.rows[0] });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to create employee' });
    }
  });

  app.post('/employees/:id/update', async (req, reply) => {
    const id = (req.params as any).id;
    const body = req.body as { tenant_id?: string; name?: string; skills?: string[]; is_active?: boolean };
    const tenantId = body.tenant_id || (req as any).auth?.tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          'UPDATE employees SET name = COALESCE($1, name), skills = COALESCE($2, skills), is_active = COALESCE($3, is_active), updated_at = NOW() WHERE id = $4 RETURNING *',
          [body.name, body.skills, body.is_active, id]
        );
      });
      return reply.send({ success: true, employee: res.rows[0] });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to update employee' });
    }
  });
}
