
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';

const CreateEmployeeSchema = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().optional(),
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  skills: z.array(z.string()).optional(),
});

const UpdateEmployeeSchema = z.object({
  tenant_id: z.string().uuid().optional(),
  name: z.string().max(200).optional(),
  first_name: z.string().max(100).optional(),
  last_name: z.string().max(100).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  skills: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
});

export function registerEmployeeRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get('/employees', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

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
  }, 'Failed to fetch employees'));

  app.post('/employees/create', withHandler(async (req: AppRequest, reply) => {
    const parsed = CreateEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;
    const firstName = body.first_name || body.name || '';
    const lastName = body.last_name || '';
    const displayName = [firstName, lastName].filter(Boolean).join(' ');

    const res = await withTenantClient(body.tenant_id, async (client) => {
      return client.query(
        'INSERT INTO employees (tenant_id, name, first_name, last_name, email, phone, skills) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [body.tenant_id, displayName, firstName, lastName, body.email || null, body.phone || null, body.skills || []]
      );
    });

    logEvent(req, 'employee_created', { employeeId: res.rows[0].id, name: displayName });
    return reply.send({ success: true, employee: res.rows[0] });
  }, 'Failed to create employee'));

  app.delete('/employees/:id/delete', withHandler(async (req: AppRequest, reply) => {
    const id = (req.params as any).id;
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        `UPDATE employees SET is_deleted = true, deleted_at = NOW(), is_active = false, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenantId]
      );
    });
    if (res.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'Employee not found' });
    }

    logEvent(req, 'employee_deleted', { employeeId: id });
    return reply.send({ success: true });
  }, 'Failed to delete employee'));

  app.post('/employees/:id/update', withHandler(async (req: AppRequest, reply) => {
    const id = (req.params as any).id;
    const parsed = UpdateEmployeeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    // Recompute display name if first/last provided
    const displayName = (body.first_name !== undefined || body.last_name !== undefined)
      ? [body.first_name, body.last_name].filter(Boolean).join(' ') || body.name
      : body.name;

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

    logEvent(req, 'employee_updated', { employeeId: id });
    return reply.send({ success: true, employee: res.rows[0] });
  }, 'Failed to update employee'));
}
