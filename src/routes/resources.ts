
import type { Pool } from 'pg';

const SUPER_ADMIN_TENANT_ID = '00000000-0000-0000-0000-000000000000';

export function registerResourceRoutes(app: any, pool: Pool) {
  app.get('/resources', async (req, reply) => {
    const tenantId = (req.query as any)['tenant_id'];
    const isSuperAdmin = tenantId === SUPER_ADMIN_TENANT_ID;
    const client = await pool.connect();
    try {
      const query = isSuperAdmin
        ? 'SELECT * FROM resources'
        : 'SELECT * FROM resources WHERE tenant_id = $1';
      const res = isSuperAdmin
        ? await client.query(query)
        : await client.query(query, [tenantId]);
      return reply.send(res.rows);
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to fetch resources' });
    } finally {
      client.release();
    }
  });

  app.post('/resources/create', async (req, reply) => {
    const body = req.body as { tenant_id: string; name: string; description?: string };
    if (!body.tenant_id || !body.name) {
      return reply.status(400).send({ success: false, error: 'tenant_id and name are required' });
    }
    const client = await pool.connect();
    try {
      const res = await client.query(
        'INSERT INTO resources (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING *',
        [body.tenant_id, body.name, body.description || null]
      );
      return reply.send({ success: true, resource: res.rows[0] });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to create resource' });
    } finally {
      client.release();
    }
  });

  app.post('/resources/:id/update', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; description?: string; is_active?: boolean };
    const client = await pool.connect();
    try {
      const fields: string[] = [];
      const values: any[] = [];
      if (body.name !== undefined) { fields.push('name'); values.push(body.name); }
      if (body.description !== undefined) { fields.push('description'); values.push(body.description || null); }
      if (body.is_active !== undefined) { fields.push('is_active'); values.push(body.is_active); }
      if (fields.length === 0) {
        return reply.status(400).send({ success: false, error: 'No updatable fields provided' });
      }
      const setClause = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
      values.push(id);
      await client.query(`UPDATE resources SET ${setClause} WHERE id = $${values.length}`, values);
      return reply.send({ success: true });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ success: false, error: 'Failed to update resource' });
    } finally {
      client.release();
    }
  });
}
