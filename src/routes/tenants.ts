
import type { Pool } from 'pg';
import { withHandler, logEvent, type AppRequest } from '../middleware';

export function registerTenantRoutes(app: any, pool: Pool) {
  app.get('/tenants', withHandler(async (req: AppRequest, reply) => {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT * FROM tenants ORDER BY sort_order ASC, created_at DESC');
      return reply.send(res.rows);
    } finally {
      client.release();
    }
  }, 'Failed to fetch tenants'));

  app.delete('/tenants/:id', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const client = await pool.connect();
    try {
      await client.query('DELETE FROM tenants WHERE id = $1', [id]);
      logEvent(req, 'tenant_deleted', { tenantId: id });
      return reply.send({ success: true });
    } finally {
      client.release();
    }
  }, 'Failed to delete tenant'));

  app.post('/tenants/:id/update-attributes', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE tenants SET
            name = $1, business_type = $2, timezone = $3, voice_id = $4,
            system_prompt = $5, first_message = $6, owner_phone = $7, inbound_phone = $8
         WHERE id = $9`,
        [body.name, body.business_type, body.timezone, body.voice_id,
         body.system_prompt, body.first_message, body.owner_phone, body.inbound_phone, id]
      );
      logEvent(req, 'tenant_attributes_updated', { tenantId: id });
      return reply.send({ success: true });
    } finally {
      client.release();
    }
  }, 'Failed to update tenant'));

  app.get('/tenants/:id/config', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const client = await pool.connect();
    try {
      const res = await client.query(
        'SELECT id, name, business_type, system_prompt, voice_id, first_message FROM tenants WHERE id = $1',
        [id]
      );
      if (res.rows.length === 0) return reply.status(404).send({ error: 'Tenant not found' });
      return reply.send(res.rows[0]);
    } finally {
      client.release();
    }
  }, 'Failed to fetch tenant config'));

  app.post('/tenants/:id/update-config', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const client = await pool.connect();
    try {
      await client.query(
        'UPDATE tenants SET system_prompt = $1, voice_id = $2, business_type = $3, first_message = $4 WHERE id = $5',
        [body.system_prompt, body.voice_id, body.business_type, body.first_message, id]
      );
      logEvent(req, 'tenant_config_updated', { tenantId: id });
      return reply.send({ success: true });
    } finally {
      client.release();
    }
  }, 'Failed to update tenant config'));

  app.post('/tenants/create', withHandler(async (req: AppRequest, reply) => {
    const body = req.body as {
      tenant_name: string;
      business_type: string;
      owner_first_name: string;
      owner_last_name: string;
      owner_email: string;
      owner_pass: string;
    };
    const client = await pool.connect();
    try {
      const firstName = (body.owner_first_name || '').trim();
      const lastName = (body.owner_last_name || '').trim();
      if (!firstName || !lastName) {
        client.release();
        return reply.status(400).send({ error: 'owner_first_name and owner_last_name are required' });
      }

      await client.query('BEGIN');
      const tenantRes = await client.query(
        'INSERT INTO tenants (name, business_type) VALUES ($1, $2) RETURNING id',
        [body.tenant_name, body.business_type]
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
      logEvent(req, 'tenant_created', { tenantId, name: body.tenant_name });
      return reply.send({ success: true, tenant_id: tenantId });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }, 'Failed to create tenant'));

  // Save tenant sort order (admin drag-and-drop reordering)
  app.post('/tenants/reorder', withHandler(async (req: AppRequest, reply) => {
    const { order } = req.body as { order: string[] }; // array of tenant IDs in desired order
    if (!Array.isArray(order) || order.length === 0) {
      return reply.status(400).send({ error: 'order must be a non-empty array of tenant IDs' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < order.length; i++) {
        await client.query('UPDATE tenants SET sort_order = $1 WHERE id = $2', [i, order[i]]);
      }
      await client.query('COMMIT');
      logEvent(req, 'tenants_reordered', { count: order.length });
      return reply.send({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }, 'Failed to save tenant order'));

  app.get('/templates', withHandler(async (req: AppRequest, reply) => {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT business_type, display_name, category, sort_order FROM business_templates ORDER BY sort_order, display_name');
      return reply.send(res.rows);
    } finally {
      client.release();
    }
  }, 'Failed to fetch templates'));

  app.get('/templates/full', withHandler(async (req: AppRequest, reply) => {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT * FROM business_templates ORDER BY sort_order, display_name');
      return reply.send(res.rows);
    } finally {
      client.release();
    }
  }, 'Failed to fetch full templates'));

  // POST /templates/create — Admin adds a new business type
  app.post('/templates/create', withHandler(async (req: AppRequest, reply) => {
    const body = req.body as {
      business_type: string; display_name: string; category: string;
      system_prompt_template?: string; first_message?: string; voice_id?: string;
      default_resource_name?: string; default_resource_description?: string;
      resource_label?: string; resource_plural?: string;
      employee_label?: string; employee_plural?: string;
      booking_label?: string; example_services?: string[];
    };
    if (!body.business_type || !body.display_name || !body.category) {
      return reply.status(400).send({ success: false, error: 'business_type, display_name, and category are required' });
    }
    const client = await pool.connect();
    try {
      const res = await client.query(`
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
      ]);
      logEvent(req, 'template_created', { businessType: body.business_type });
      return reply.send({ success: true, template: res.rows[0] });
    } finally {
      client.release();
    }
  }, 'Failed to create template'));
}
