
import type { Pool, PoolClient } from 'pg';
import { withHandler, logEvent, type AppRequest } from '../middleware';

export function registerShiftRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get('/shifts', withHandler(async (req: AppRequest, reply) => {
    const tenantId = req.tenantId;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query('SELECT * FROM employee_shifts WHERE tenant_id = $1 ORDER BY day_of_week, start_time', [tenantId]);
    });
    return reply.send(res.rows);
  }, 'Failed to fetch shifts'));

  app.post('/shifts/create', withHandler(async (req: AppRequest, reply) => {
    const body = req.body as { tenant_id: string; employee_id: number; day_of_week: number; start_time: string; end_time: string };

    const res = await withTenantClient(body.tenant_id, async (client) => {
      return client.query(
        'INSERT INTO employee_shifts (tenant_id, employee_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [body.tenant_id, body.employee_id, body.day_of_week, body.start_time, body.end_time]
      );
    });

    logEvent(req, 'shift_created', { shiftId: res.rows[0].id, employeeId: body.employee_id, dayOfWeek: body.day_of_week });
    return reply.send({ success: true, shift: res.rows[0] });
  }, 'Failed to create shift'));

  app.post('/shifts/:id/update', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { tenant_id: string; start_time?: string; end_time?: string; day_of_week?: number; is_active?: boolean };

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

    logEvent(req, 'shift_updated', { shiftId: id });
    return reply.send({ success: true, shift: res.rows[0] });
  }, 'Failed to update shift'));

  app.delete('/shifts/:id', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = req.tenantId;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    await withTenantClient(tenantId, async (client) => {
      await client.query('DELETE FROM employee_shifts WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    });

    logEvent(req, 'shift_deleted', { shiftId: id });
    return reply.send({ success: true });
  }, 'Failed to delete shift'));
}
