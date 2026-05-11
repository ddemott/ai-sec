
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';

const CreateSkillSchema = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional().nullable(),
});

export function registerSkillRoutes(
  app: FastifyInstance<any, any, any>,
  _pool: Pool,
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
    const parsed = CreateSkillSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;

    const res = await withTenantClient(body.tenant_id, async (client) => {
      return client.query(
        'INSERT INTO tenant_skills (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING *',
        [body.tenant_id, body.name.toLowerCase().trim().replace(/\s+/g, '-'), body.description]
      );
    });

    logEvent(req, 'skill_created', { skillId: res.rows[0].tenant_skill_id, name: body.name });
    return reply.send({ success: true, skill: res.rows[0] });
  }, 'Failed to create skill'));

  app.delete('/skills/:id', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query('DELETE FROM tenant_skills WHERE tenant_skill_id = $1 AND tenant_id = $2 RETURNING tenant_skill_id', [id, tenantId]);
    });

    if (res.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'Skill not found' });
    }

    logEvent(req, 'skill_deleted', { skillId: id });
    return reply.send({ success: true });
  }, 'Failed to delete skill'));
}
