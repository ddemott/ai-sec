
import type { Pool } from 'pg';
import { z } from 'zod';
import { withHandler, withPoolClient, logEvent, requireAuth, type AppRequest } from '../middleware';

const CreateTenantSchema = z.object({
  tenant_name: z.string().min(1).max(200),
  business_type: z.string().min(1).max(50),
  owner_first_name: z.string().min(1).max(100),
  owner_last_name: z.string().min(1).max(100),
  owner_email: z.string().email(),
  owner_pass: z.string().min(6).max(200),
});

const UpdateAttributesSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  business_type: z.string().max(50).optional(),
  timezone: z.string().max(50).optional(),
  voice_id: z.string().max(100).optional().nullable(),
  system_prompt: z.string().optional().nullable(),
  first_message: z.string().optional().nullable(),
  owner_phone: z.string().max(30).optional().nullable(),
  inbound_phone: z.string().max(30).optional().nullable(),
});

const UpdateConfigSchema = z.object({
  system_prompt: z.string().optional().nullable(),
  voice_id: z.string().max(100).optional().nullable(),
  business_type: z.string().max(50).optional(),
  first_message: z.string().optional().nullable(),
});

const CreateTemplateSchema = z.object({
  business_type: z.string().min(1).max(50),
  display_name: z.string().min(1).max(100),
  category: z.string().min(1).max(50),
  system_prompt_template: z.string().optional(),
  first_message: z.string().optional(),
  voice_id: z.string().optional().nullable(),
  default_resource_name: z.string().optional(),
  default_resource_description: z.string().optional().nullable(),
  resource_label: z.string().optional(),
  resource_plural: z.string().optional(),
  employee_label: z.string().optional(),
  employee_plural: z.string().optional(),
  booking_label: z.string().optional(),
  example_services: z.array(z.string()).optional(),
});

export function registerTenantRoutes(app: any, pool: Pool) {
  app.get('/tenants', withHandler(async (req: AppRequest, reply) => {
    if (!requireAuth(req, reply)) return;
    const res = await withPoolClient(pool, client =>
      client.query('SELECT * FROM tenants ORDER BY sort_order ASC, created_at DESC')
    );
    return reply.send(res.rows);
  }, 'Failed to fetch tenants'));

  app.delete('/tenants/:id', withHandler(async (req: AppRequest, reply) => {
    if (!requireAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    await withPoolClient(pool, client =>
      client.query('DELETE FROM tenants WHERE id = $1', [id])
    );
    logEvent(req, 'tenant_deleted', { tenantId: id });
    return reply.send({ success: true });
  }, 'Failed to delete tenant'));

  app.post('/tenants/:id/update-attributes', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const parsed = UpdateAttributesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;
    await withPoolClient(pool, client =>
      client.query(
        `UPDATE tenants SET
            name = $1, business_type = $2, timezone = $3, voice_id = $4,
            system_prompt = $5, first_message = $6, owner_phone = $7, inbound_phone = $8
         WHERE id = $9`,
        [body.name, body.business_type, body.timezone, body.voice_id,
         body.system_prompt, body.first_message, body.owner_phone, body.inbound_phone, id]
      )
    );
    logEvent(req, 'tenant_attributes_updated', { tenantId: id });
    return reply.send({ success: true });
  }, 'Failed to update tenant'));

  app.get('/tenants/:id/config', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const res = await withPoolClient(pool, client =>
      client.query(
        'SELECT id, name, business_type, system_prompt, voice_id, first_message, team_size, timezone FROM tenants WHERE id = $1',
        [id]
      )
    );
    if (res.rows.length === 0) return reply.status(404).send({ success: false, error: 'Tenant not found' });
    return reply.send(res.rows[0]);
  }, 'Failed to fetch tenant config'));

  app.post('/tenants/:id/update-config', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const parsed = UpdateConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;
    await withPoolClient(pool, client =>
      client.query(
        'UPDATE tenants SET system_prompt = $1, voice_id = $2, business_type = $3, first_message = $4 WHERE id = $5',
        [body.system_prompt, body.voice_id, body.business_type, body.first_message, id]
      )
    );
    logEvent(req, 'tenant_config_updated', { tenantId: id });
    return reply.send({ success: true });
  }, 'Failed to update tenant config'));

  app.post('/tenants/create', withHandler(async (req: AppRequest, reply) => {
    const parsed = CreateTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;
    const firstName = body.owner_first_name.trim();
    const lastName = body.owner_last_name.trim();

    const result = await withPoolClient(pool, async (client) => {
      await client.query('BEGIN');
      try {
        // Prevent duplicate tenant names
        const existing = await client.query(
          'SELECT id FROM tenants WHERE LOWER(name) = LOWER($1)',
          [body.tenant_name.trim()]
        );
        if (existing.rows.length > 0) {
          await client.query('ROLLBACK');
          return { error: `A business named "${body.tenant_name.trim()}" already exists.` };
        }

        const tenantRes = await client.query(
          'INSERT INTO tenants (name, business_type) VALUES ($1, $2) RETURNING id',
          [body.tenant_name.trim(), body.business_type]
        );
        const tenantId = tenantRes.rows[0].id;

        const fullName = [firstName, lastName].filter(Boolean).join(' ');
        const bcrypt = await import('bcrypt');
        const hashedPass = await bcrypt.hash(body.owner_pass, 10);
        await client.query(
          'INSERT INTO users (tenant_id, email, password_hash, full_name, first_name, last_name) VALUES ($1, $2, $3, $4, $5, $6)',
          [tenantId, body.owner_email, hashedPass, fullName, firstName || null, lastName || null]
        );

        await client.query('COMMIT');
        return tenantId;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
    if (result && typeof result === 'object' && 'error' in result) {
      return reply.status(409).send({ success: false, error: result.error });
    }
    logEvent(req, 'tenant_created', { tenantId: result, name: body.tenant_name });
    return reply.send({ success: true, tenant_id: result });
  }, 'Failed to create tenant'));

  // Save tenant sort order (admin drag-and-drop reordering)
  app.post('/tenants/reorder', withHandler(async (req: AppRequest, reply) => {
    if (!requireAuth(req, reply)) return;
    const { order } = req.body as { order: string[] }; // array of tenant IDs in desired order
    if (!Array.isArray(order) || order.length === 0) {
      return reply.status(400).send({ success: false, error: 'order must be a non-empty array of tenant IDs' });
    }
    await withPoolClient(pool, async (client) => {
      await client.query('BEGIN');
      try {
        for (let i = 0; i < order.length; i++) {
          await client.query('UPDATE tenants SET sort_order = $1 WHERE id = $2', [i, order[i]]);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
    logEvent(req, 'tenants_reordered', { count: order.length });
    return reply.send({ success: true });
  }, 'Failed to save tenant order'));

  app.get('/templates', withHandler(async (_req: AppRequest, reply) => {
    const res = await withPoolClient(pool, client =>
      client.query('SELECT business_type, display_name, category, sort_order FROM business_templates ORDER BY display_name')
    );
    return reply.send(res.rows);
  }, 'Failed to fetch templates'));

  app.get('/templates/full', withHandler(async (_req: AppRequest, reply) => {
    const res = await withPoolClient(pool, client =>
      client.query('SELECT * FROM business_templates ORDER BY display_name')
    );
    return reply.send(res.rows);
  }, 'Failed to fetch full templates'));

  // POST /templates/create — Admin adds a new business type
  app.post('/templates/create', withHandler(async (req: AppRequest, reply) => {
    const parsed = CreateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;
    const res = await withPoolClient(pool, client =>
      client.query(`
        INSERT INTO business_templates (
          business_type, display_name, category,
          system_prompt_template, first_message, voice_id,
          default_resource_name, default_resource_description,
          resource_label, resource_plural, employee_label, employee_plural,
          booking_label, example_services
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (business_type) DO UPDATE SET
          display_name = EXCLUDED.display_name, category = EXCLUDED.category,
          system_prompt_template = COALESCE(EXCLUDED.system_prompt_template, business_templates.system_prompt_template),
          first_message = COALESCE(EXCLUDED.first_message, business_templates.first_message),
          voice_id = COALESCE(EXCLUDED.voice_id, business_templates.voice_id),
          default_resource_name = COALESCE(EXCLUDED.default_resource_name, business_templates.default_resource_name),
          default_resource_description = COALESCE(EXCLUDED.default_resource_description, business_templates.default_resource_description),
          resource_label = COALESCE(EXCLUDED.resource_label, business_templates.resource_label),
          resource_plural = COALESCE(EXCLUDED.resource_plural, business_templates.resource_plural),
          employee_label = COALESCE(EXCLUDED.employee_label, business_templates.employee_label),
          employee_plural = COALESCE(EXCLUDED.employee_plural, business_templates.employee_plural),
          booking_label = COALESCE(EXCLUDED.booking_label, business_templates.booking_label),
          example_services = COALESCE(EXCLUDED.example_services, business_templates.example_services)
        RETURNING *
      `, [
        body.business_type, body.display_name, body.category,
        body.system_prompt_template || `You are a professional receptionist for {{business_name}}.`,
        body.first_message || `Thanks for calling! How can we help you today?`,
        body.voice_id || null,
        body.default_resource_name || 'Station 1',
        body.default_resource_description || null,
        body.resource_label || 'Resource', body.resource_plural || 'Resources',
        body.employee_label || 'Employee', body.employee_plural || 'Employees',
        body.booking_label || 'Appointment',
        body.example_services || '{}'
      ])
    );
    logEvent(req, 'template_created', { businessType: body.business_type });
    return reply.send({ success: true, template: res.rows[0] });
  }, 'Failed to create template'));
}
