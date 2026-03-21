
import type { Pool, PoolClient } from 'pg';

export function registerSkillRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get('/skills', async (req, reply) => {
    const tenantId = (req.query as any).tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      const res = await withTenantClient(tenantId, async (client) => {
        return client.query('SELECT * FROM tenant_skills WHERE tenant_id = $1 ORDER BY name', [tenantId]);
      });
      return reply.send(res.rows);
    } catch (err) {
      if (err instanceof Error && (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND') throw err;
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch master skills' });
    }
  });

  app.post('/skills/create', async (req, reply) => {
    const body = req.body as { tenant_id: string; name: string; description?: string };

    try {
      const res = await withTenantClient(body.tenant_id, async (client) => {
        return client.query(
          'INSERT INTO tenant_skills (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING *',
          [body.tenant_id, body.name.toLowerCase().trim().replace(/\s+/g, '-'), body.description]
        );
      });
      return reply.send({ success: true, skill: res.rows[0] });
    } catch (err: any) {
      if (err instanceof Error && (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND') throw err;
      if (err.code === '23505') return reply.status(400).send({ error: 'Skill already exists' });
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to create skill' });
    }
  });

  app.delete('/skills/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = (req.query as any).tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      await withTenantClient(tenantId, async (client) => {
        await client.query('DELETE FROM tenant_skills WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
      });
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof Error && (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND') throw err;
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to delete skill' });
    }
  });
}
