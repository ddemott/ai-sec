
import type { Pool } from 'pg';

export function registerSkillRoutes(app: any, pool: Pool) {
  app.get('/skills', async (req, reply) => {
    const tenantId = (req.query as any).tenant_id;
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT * FROM tenant_skills WHERE tenant_id = $1 ORDER BY name', [tenantId]);
      return reply.send(res.rows);
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch master skills' });
    } finally {
      client.release();
    }
  });

  app.post('/skills/create', async (req, reply) => {
    const body = req.body as { tenant_id: string; name: string; description?: string };
    const client = await pool.connect();
    try {
      const res = await client.query(
        'INSERT INTO tenant_skills (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING *',
        [body.tenant_id, body.name.toLowerCase().trim().replace(/\s+/g, '-'), body.description]
      );
      return reply.send({ success: true, skill: res.rows[0] });
    } catch (err: any) {
      if (err.code === '23505') return reply.status(400).send({ error: 'Skill already exists' });
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to create skill' });
    } finally {
      client.release();
    }
  });

  app.delete('/skills/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = (req.query as any).tenant_id;
    const client = await pool.connect();
    try {
      await client.query('DELETE FROM tenant_skills WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
      return reply.send({ success: true });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to delete skill' });
    } finally {
      client.release();
    }
  });
}
