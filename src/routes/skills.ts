
import type { Pool, PoolClient } from 'pg';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';

export function registerSkillRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get('/skills', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query('SELECT * FROM tenant_skills WHERE tenant_id = $1 ORDER BY name', [tenantId]);
    });
    return reply.send(res.rows);
  }, 'Failed to fetch master skills'));

  app.post('/skills/create', withHandler(async (req: AppRequest, reply) => {
    const body = req.body as { tenant_id: string; name: string; description?: string };

    const res = await withTenantClient(body.tenant_id, async (client) => {
      return client.query(
        'INSERT INTO tenant_skills (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING *',
        [body.tenant_id, body.name.toLowerCase().trim().replace(/\s+/g, '-'), body.description]
      );
    });

    logEvent(req, 'skill_created', { skillId: res.rows[0].id, name: body.name });
    return reply.send({ success: true, skill: res.rows[0] });
  }, 'Failed to create skill'));

  app.delete('/skills/:id', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    await withTenantClient(tenantId, async (client) => {
      await client.query('DELETE FROM tenant_skills WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    });

    logEvent(req, 'skill_deleted', { skillId: id });
    return reply.send({ success: true });
  }, 'Failed to delete skill'));
}
