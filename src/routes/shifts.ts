
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';

const CreateShiftSchema = z.object({
  tenant_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
});

const UpdateShiftSchema = z.object({
  tenant_id: z.string().uuid(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  day_of_week: z.number().int().min(0).max(6).optional(),
  is_active: z.boolean().optional(),
});

const CreateOverrideSchema = z.object({
  tenant_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  is_off: z.boolean().default(false),
});

const UpdateOverrideSchema = z.object({
  tenant_id: z.string().uuid(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  is_off: z.boolean().optional(),
});

const CopyWeekSchema = z.object({
  tenant_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  source_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  target_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export function registerShiftRoutes(
  app: any,
  _pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get('/shifts', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query('SELECT * FROM employee_shifts WHERE tenant_id = $1 ORDER BY day_of_week, start_time', [tenantId]);
    });
    return reply.send(res.rows);
  }, 'Failed to fetch shifts'));

  app.post('/shifts/create', withHandler(async (req: AppRequest, reply) => {
    const parsed = CreateShiftSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;

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
    const parsed = UpdateShiftSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;

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
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query('DELETE FROM employee_shifts WHERE id = $1 AND tenant_id = $2 RETURNING id', [id, tenantId]);
    });

    if (res.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'Shift not found' });
    }

    logEvent(req, 'shift_deleted', { shiftId: id });
    return reply.send({ success: true });
  }, 'Failed to delete shift'));

  // ── Shift Overrides (date-specific) ────────────────────────────

  app.get('/shifts/overrides', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const { employee_id, start_date, end_date } = req.query as Record<string, string>;

    if (employee_id && start_date && end_date) {
      // Use the RPC for merged view
      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          'SELECT * FROM get_effective_shifts($1, $2, $3::DATE, $4::DATE)',
          [tenantId, employee_id, start_date, end_date]
        );
      });
      return reply.send(res.rows);
    }

    // Raw overrides list
    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        'SELECT * FROM shift_overrides WHERE tenant_id = $1 ORDER BY shift_date',
        [tenantId]
      );
    });
    return reply.send(res.rows);
  }, 'Failed to fetch shift overrides'));

  app.post('/shifts/overrides/create', withHandler(async (req: AppRequest, reply) => {
    const parsed = CreateOverrideSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;

    const res = await withTenantClient(body.tenant_id, async (client) => {
      return client.query(
        `INSERT INTO shift_overrides (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, employee_id, shift_date)
         DO UPDATE SET start_time = $4, end_time = $5, is_off = $6, updated_at = now()
         RETURNING *`,
        [body.tenant_id, body.employee_id, body.shift_date, body.start_time || null, body.end_time || null, body.is_off]
      );
    });

    logEvent(req, 'shift_override_created', { overrideId: res.rows[0].id, employeeId: body.employee_id, date: body.shift_date });
    return reply.send({ success: true, override: res.rows[0] });
  }, 'Failed to create shift override'));

  app.post('/shifts/overrides/:id/update', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const parsed = UpdateOverrideSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;

    const res = await withTenantClient(body.tenant_id, async (client) => {
      return client.query(
        `UPDATE shift_overrides SET
          start_time = COALESCE($1, start_time), end_time = COALESCE($2, end_time),
          is_off = COALESCE($3, is_off), updated_at = now()
        WHERE id = $4 AND tenant_id = $5 RETURNING *`,
        [body.start_time, body.end_time, body.is_off, id, body.tenant_id]
      );
    });
    if (res.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'Override not found' });
    }

    logEvent(req, 'shift_override_updated', { overrideId: id });
    return reply.send({ success: true, override: res.rows[0] });
  }, 'Failed to update shift override'));

  app.delete('/shifts/overrides/:id', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query('DELETE FROM shift_overrides WHERE id = $1 AND tenant_id = $2 RETURNING id', [id, tenantId]);
    });

    if (res.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'Override not found' });
    }

    logEvent(req, 'shift_override_deleted', { overrideId: id });
    return reply.send({ success: true });
  }, 'Failed to delete shift override'));

  app.post('/shifts/copy-week', withHandler(async (req: AppRequest, reply) => {
    const parsed = CopyWeekSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const { tenant_id, employee_id, source_start, target_start } = parsed.data;

    // Get effective shifts for the source week (7 days)
    const sourceEnd = new Date(source_start);
    sourceEnd.setDate(sourceEnd.getDate() + 6);
    const sourceEndStr = sourceEnd.toISOString().slice(0, 10);

    const effective = await withTenantClient(tenant_id, async (client) => {
      return client.query(
        'SELECT * FROM get_effective_shifts($1, $2, $3::DATE, $4::DATE)',
        [tenant_id, employee_id, source_start, sourceEndStr]
      );
    });

    // Calculate day offset between source and target week
    const srcDate = new Date(source_start);
    const tgtDate = new Date(target_start);
    const dayOffset = Math.round((tgtDate.getTime() - srcDate.getTime()) / (1000 * 60 * 60 * 24));

    // Create overrides for the target week
    let created = 0;
    await withTenantClient(tenant_id, async (client) => {
      for (const row of effective.rows) {
        const targetDate = new Date(row.shift_date);
        targetDate.setDate(targetDate.getDate() + dayOffset);
        const targetDateStr = targetDate.toISOString().slice(0, 10);

        await client.query(
          `INSERT INTO shift_overrides (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (tenant_id, employee_id, shift_date)
           DO UPDATE SET start_time = $4, end_time = $5, is_off = $6, updated_at = now()`,
          [tenant_id, employee_id, targetDateStr, row.start_time, row.end_time, row.is_off]
        );
        created++;
      }
    });

    logEvent(req, 'shifts_copied', { employeeId: employee_id, from: source_start, to: target_start, count: created });
    return reply.send({ success: true, copied: created });
  }, 'Failed to copy week'));
}
