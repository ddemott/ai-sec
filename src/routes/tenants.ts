
import type { Pool } from 'pg';

export function registerTenantRoutes(app: any, pool: Pool) {
  app.get('/tenants', async (req, reply) => {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT * FROM tenants ORDER BY created_at DESC');
      app.log.info(`Found ${res.rows.length} tenants`);
      return reply.send(res.rows);
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch tenants' });
    } finally {
      client.release();
    }
  });

  app.delete('/tenants/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const client = await pool.connect();
    try {
      await client.query('DELETE FROM tenants WHERE id = $1', [id]);
      return reply.send({ success: true });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to delete tenant' });
    } finally {
      client.release();
    }
  });

  app.post('/tenants/:id/update-attributes', async (req, reply) => {
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
      return reply.send({ success: true });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to update tenant' });
    } finally {
      client.release();
    }
  });

  app.get('/tenants/:id/config', async (req, reply) => {
    const { id } = req.params as { id: string };
    const client = await pool.connect();
    try {
      const res = await client.query(
        'SELECT id, name, business_type, system_prompt, voice_id, first_message FROM tenants WHERE id = $1',
        [id]
      );
      if (res.rows.length === 0) return reply.status(404).send({ error: 'Tenant not found' });
      return reply.send(res.rows[0]);
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to fetch tenant config' });
    } finally {
      client.release();
    }
  });

  app.post('/tenants/:id/update-config', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const client = await pool.connect();
    try {
      await client.query(
        'UPDATE tenants SET system_prompt = $1, voice_id = $2, business_type = $3, first_message = $4 WHERE id = $5',
        [body.system_prompt, body.voice_id, body.business_type, body.first_message, id]
      );
      return reply.send({ success: true });
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to update tenant config' });
    } finally {
      client.release();
    }
  });

  app.post('/tenants/create', async (req, reply) => {
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
      return reply.send({ success: true, tenant_id: tenantId });
    } catch (err) {
      await client.query('ROLLBACK');
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to create tenant' });
    } finally {
      client.release();
    }
  });

  app.get('/templates', async (req, reply) => {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT business_type, display_name FROM business_templates');
      return reply.send(res.rows);
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to fetch templates' });
    } finally {
      client.release();
    }
  });

  app.get('/templates/full', async (req, reply) => {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT * FROM business_templates');
      return reply.send(res.rows);
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to fetch full templates' });
    } finally {
      client.release();
    }
  });
}
