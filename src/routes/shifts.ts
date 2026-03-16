
import type { Pool, PoolClient } from 'pg';

export function registerShiftRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get('/shifts', async (req, reply) => {
    const tenantId = (req.query as any).tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      const res = await withTenantClient(tenantId, async (client) => {
        return client.query('SELECT * FROM employee_shifts WHERE tenant_id = $1 ORDER BY day_of_week, start_time', [tenantId]);
      });
      return reply.send(res.rows);
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch shifts' });
    }
  });

  app.post('/shifts/create', async (req, reply) => {
    const body = req.body as { tenant_id: string; employee_id: number; day_of_week: number; start_time: string; end_time: string };

    try {
      const res = await withTenantClient(body.tenant_id, async (client) => {
        return client.query(
          'INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4, $5) RETURNING *',
          [body.tenant_id, body.employee_id, body.day_of_week, body.start_time, body.end_time]
        );
      });
      return reply.send({ success: true, shift: res.rows[0] });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to create shift' });
    }
  });

  app.post('/shifts/:id/update', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { tenant_id: string; start_time?: string; end_time?: string; day_of_week?: number; is_active?: boolean };

    try {
      const res = await withTenantClient(body.tenant_id, async (client) => {
        return client.query(
          `UPDATE employee_shifts SET
            start_time = COALESCE($1, start_time), end_time = COALESCE($2, end_time),
            day_of_week = COALESCE($3, day_of_week), is_active = COALESCE($4, is_active)
          WHERE id = $5 AND tenant_id = $6 RETURNING *`,
          [body.start_time, body.end_time, body.day_of_week, body.is_active, id, body.tenant_id]
        );
      });
      if (res.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Shift not found' });
      }
      return reply.send({ success: true, shift: res.rows[0] });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to update shift' });
    }
  });

  app.delete('/shifts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = (req.query as any).tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      await withTenantClient(tenantId, async (client) => {
        await client.query('DELETE FROM employee_shifts WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
      });
      return reply.send({ success: true });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to delete shift' });
    }
  });
}
