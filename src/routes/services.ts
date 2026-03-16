
import type { Pool } from 'pg';

export function registerServiceRoutes(app: any, pool: Pool) {
  app.get('/services', async (req, reply) => {
    const tenantId = (req.query as any).tenant_id;
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT * FROM services WHERE tenant_id = $1 ORDER BY name ASC', [tenantId]);
      return reply.send(res.rows);
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch services' });
    } finally {
      client.release();
    }
  });

  app.post('/services/create', async (req, reply) => {
    const body = req.body as { tenant_id: string; name: string; description?: string; duration_minutes: number; required_skills?: string[]; required_resources?: string[] };
    const client = await pool.connect();
    try {
      const res = await client.query(
        'INSERT INTO services (tenant_id, name, description, duration_minutes, required_skills, required_resources) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [body.tenant_id, body.name, body.description, body.duration_minutes, body.required_skills || [], body.required_resources || []]
      );
      return reply.send({ success: true, service: res.rows[0] });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to create service' });
    } finally {
      client.release();
    }
  });

  app.post('/services/:id/update', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; description?: string; duration_minutes?: number; price?: number };
    const client = await pool.connect();
    try {
      const res = await client.query(
        'UPDATE services SET name = COALESCE($1, name), description = COALESCE($2, description), duration_minutes = COALESCE($3, duration_minutes), price = COALESCE($4, price), updated_at = NOW() WHERE id = $5 RETURNING *',
        [body.name, body.description, body.duration_minutes, body.price, id]
      );
      return reply.send({ success: true, service: res.rows[0] });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to update service' });
    } finally {
      client.release();
    }
  });

  app.delete('/services/:id/delete', async (req, reply) => {
    const { id } = req.params as { id: string };
    const client = await pool.connect();
    try {
      const mappings = await client.query(
        'SELECT (SELECT count(*) FROM service_resource WHERE service_id = $1) + (SELECT count(*) FROM service_employee WHERE service_id = $1) as count',
        [id]
      );
      if (parseInt(mappings.rows[0].count) > 0) {
        return reply.status(400).send({ error: 'Cannot delete: Service is still mapped to staff or resources. Unassign them first.' });
      }
      await client.query('DELETE FROM services WHERE id = $1', [id]);
      return reply.send({ success: true });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to delete service' });
    } finally {
      client.release();
    }
  });
}
