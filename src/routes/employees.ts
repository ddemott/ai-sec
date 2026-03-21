
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
          SELECT id::text, name, first_name, last_name, email, phone, skills, is_active, 'employee' as type
          FROM employees WHERE tenant_id = $1 AND is_deleted = false
          UNION ALL
          SELECT id::text, COALESCE(full_name, email) as name, NULL as first_name, NULL as last_name, email, NULL as phone, '{}'::text[] as skills, true as is_active, 'user' as type
          FROM users WHERE tenant_id = $1
          ORDER BY name ASC
        `, [tenantId]);
      });
      return reply.send(res.rows);
    } catch (err) {
      if (err instanceof Error && (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND') throw err;
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch employees' });
    }
  });

  app.post('/employees/create', async (req, reply) => {
    const body = req.body as { tenant_id: string; name?: string; first_name?: string; last_name?: string; email?: string; phone?: string; skills?: string[] };
    const firstName = body.first_name || body.name || '';
    const lastName = body.last_name || '';
    const displayName = [firstName, lastName].filter(Boolean).join(' ');

    try {
      const res = await withTenantClient(body.tenant_id, async (client) => {
        return client.query(
          'INSERT INTO employees (tenant_id, name, first_name, last_name, email, phone, skills) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
          [body.tenant_id, displayName, firstName, lastName, body.email || null, body.phone || null, body.skills || []]
        );
      });
      return reply.send({ success: true, employee: res.rows[0] });
    } catch (err) {
      if (err instanceof Error && (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND') throw err;
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to create employee' });
    }
  });

  app.delete('/employees/:id/delete', async (req, reply) => {
    const id = (req.params as any).id;
    const tenantId = (req.body as any)?.tenant_id || (req.query as any)?.tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          `UPDATE employees SET is_deleted = true, deleted_at = NOW(), is_active = false, updated_at = NOW()
           WHERE id = $1 AND tenant_id = $2 RETURNING id`,
          [id, tenantId]
        );
      });
      if (res.rows.length === 0) {
        return reply.status(404).send({ error: 'Employee not found' });
      }
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof Error && (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND') throw err;
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to delete employee' });
    }
  });

  app.post('/employees/:id/update', async (req, reply) => {
    const id = (req.params as any).id;
    const body = req.body as { tenant_id?: string; name?: string; first_name?: string; last_name?: string; email?: string; phone?: string; skills?: string[]; is_active?: boolean };
    const tenantId = body.tenant_id || (req as any).auth?.tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    // Recompute display name if first/last provided
    const displayName = (body.first_name !== undefined || body.last_name !== undefined)
      ? [body.first_name, body.last_name].filter(Boolean).join(' ') || body.name
      : body.name;

    try {
      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          `UPDATE employees SET
            name = COALESCE($1, name),
            first_name = COALESCE($2, first_name),
            last_name = COALESCE($3, last_name),
            email = COALESCE($4, email),
            phone = COALESCE($5, phone),
            skills = COALESCE($6, skills),
            is_active = COALESCE($7, is_active),
            updated_at = NOW()
          WHERE id = $8 RETURNING *`,
          [displayName, body.first_name, body.last_name, body.email, body.phone, body.skills, body.is_active, id]
        );
      });
      return reply.send({ success: true, employee: res.rows[0] });
    } catch (err) {
      if (err instanceof Error && (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND') throw err;
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to update employee' });
    }
  });
}
