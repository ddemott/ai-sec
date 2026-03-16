
import type { Pool } from 'pg';

export function registerCalendarRoutes(app: any, pool: Pool) {
  app.post('/calendar/sync', async (req, reply) => {
    const body = req.body as any;
    return reply.status(202).send({ status: 'accepted', source: body?.provider || 'unknown' });
  });

  app.get('/calendar/settings', async (req, reply) => {
    const tenantId = (req.query as any).tenant_id;
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT * FROM tenant_calendar_settings WHERE tenant_id = $1', [tenantId]);
      return reply.send(res.rows[0] || null);
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch calendar settings' });
    } finally {
      client.release();
    }
  });

  app.post('/calendar/settings', async (req, reply) => {
    const body = req.body as any;
    const client = await pool.connect();
    try {
      const res = await client.query(
        `INSERT INTO tenant_calendar_settings (tenant_id, provider, external_calendar_id, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (tenant_id)
         DO UPDATE SET provider = $2, external_calendar_id = $3, is_active = true, updated_at = NOW()
         RETURNING *`,
        [body.tenant_id, body.provider, body.external_calendar_id]
      );
      return reply.send({ success: true, settings: res.rows[0] });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to update calendar settings' });
    } finally {
      client.release();
    }
  });

  app.post('/calendar/settings/disconnect', async (req, reply) => {
    const { tenant_id } = req.body as any;
    const client = await pool.connect();
    try {
      await client.query('DELETE FROM tenant_calendar_settings WHERE tenant_id = $1', [tenant_id]);
      return reply.send({ success: true });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to disconnect calendar' });
    } finally {
      client.release();
    }
  });
}
