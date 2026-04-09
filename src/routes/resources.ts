
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { SUPER_ADMIN_TENANT_ID } from '../constants';
import { withHandler, logEvent, requireTenantId, withPoolClient, type AppRequest } from '../middleware';

const CreateResourceSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional().nullable(),
});

const UpdateResourceSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional().nullable(),
  is_active: z.boolean().optional(),
  capabilities: z.array(z.string()).optional(),
});

export function registerResourceRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get('/resources', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query('SELECT * FROM resources WHERE tenant_id = $1 AND is_deleted = false ORDER BY name', [tenantId]);
    });
    return reply.send(res.rows);
  }, 'Failed to fetch resources'));

  app.post('/resources/create', withHandler(async (req: AppRequest, reply) => {
    const parsed = CreateResourceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

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
    const parsed = UpdateResourceSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;
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
      values.push(tenantId);
      await client.query(`UPDATE resources SET ${setClause} WHERE id = $${values.length - 1} AND tenant_id = $${values.length}`, values);
    });

    logEvent(req, 'resource_updated', { resourceId: id });
    return reply.send({ success: true });
  }, 'Failed to update resource'));

  app.delete('/resources/:id/delete', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        `UPDATE resources SET is_deleted = true, deleted_at = NOW(), is_active = false
         WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenantId]
      );
    });
    if (res.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'Resource not found' });
    }

    logEvent(req, 'resource_deleted', { resourceId: id });
    return reply.send({ success: true });
  }, 'Failed to delete resource'));
}
