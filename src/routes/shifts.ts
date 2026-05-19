import type { AppFastifyInstance } from '../types/fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';
import { expandWeeklyToSchedule } from '../services/expandWeeklyToSchedule';

const CreateOverrideSchema = z.object({
  tenant_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  is_off: z.boolean().default(false),
});

const UpdateOverrideSchema = z.object({
  tenant_id: z.string().uuid(),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  is_off: z.boolean().optional(),
});

const CopyWeekSchema = z.object({
  tenant_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  source_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  target_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const WeeklyPatternRowSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
});

const ExpandWeeklySchema = z.object({
  tenant_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  pattern: z.array(WeeklyPatternRowSchema),
  weeks_ahead: z.number().int().min(1).max(52).optional(),
});

export function registerShiftRoutes(
  app: AppFastifyInstance,
  _pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  // No legacy /shifts CRUD anymore — the wizard collects the weekly
  // pattern in form state and posts it directly to /shifts/expand-weekly.
  // The remaining endpoints all read/write employee_schedule
  // (date-specific) directly.

  // ── Employee Schedule (date-specific) ────────────────────────────

  app.get(
    '/shifts/overrides',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      const { employee_id, start_date, end_date } = req.query as Record<string, string>;

      if (employee_id && start_date && end_date) {
        // Use the RPC for merged view (single employee)
        const res = await withTenantClient(tenantId, async (client) => {
          return client.query('SELECT * FROM get_effective_shifts($1, $2, $3::DATE, $4::DATE)', [
            tenantId,
            employee_id,
            start_date,
            end_date,
          ]);
        });
        return reply.send(res.rows);
      }

      if (start_date && end_date) {
        // Bulk effective shifts for ALL employees (used by scheduler)
        const res = await withTenantClient(tenantId, async (client) => {
          return client.query('SELECT * FROM get_effective_shifts_bulk($1, $2::DATE, $3::DATE)', [
            tenantId,
            start_date,
            end_date,
          ]);
        });
        return reply.send(res.rows);
      }

      // Raw overrides list
      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          'SELECT * FROM employee_schedule WHERE tenant_id = $1 ORDER BY shift_date',
          [tenantId]
        );
      });
      return reply.send(res.rows);
    }, 'Failed to fetch shift overrides')
  );

  app.post(
    '/shifts/overrides/create',
    withHandler(async (req: AppRequest, reply) => {
      const parsed = CreateOverrideSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }
      const body = parsed.data;

      const res = await withTenantClient(body.tenant_id, async (client) => {
        return client.query(
          `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, employee_id, shift_date)
         DO UPDATE SET start_time = $4, end_time = $5, is_off = $6, updated_at = now()
         RETURNING *`,
          [
            body.tenant_id,
            body.employee_id,
            body.shift_date,
            body.start_time || null,
            body.end_time || null,
            body.is_off,
          ]
        );
      });

      logEvent(req, 'shift_override_created', {
        tenantId: body.tenant_id,
        employeeId: body.employee_id,
        date: body.shift_date,
      });
      return reply.send({ success: true, override: res.rows[0] });
    }, 'Failed to create shift override')
  );

  // 2026-05-18 composite-key retrofit pilot #3: the surrogate
  // `employee_schedule_id` was dropped. Both the update and delete
  // routes now take (employee_id, shift_date) as path segments and
  // derive tenant_id from JWT context via requireTenantId, matching
  // the natural-key shape of the row. Tenant_id in the body is no
  // longer consulted (was already redundant with JWT).
  app.post(
    '/shifts/overrides/:employeeId/:shiftDate/update',
    withHandler(async (req: AppRequest, reply) => {
      const { employeeId, shiftDate } = req.params as { employeeId: string; shiftDate: string };
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const parsed = UpdateOverrideSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }
      const body = parsed.data;

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          `UPDATE employee_schedule SET
          start_time = COALESCE($1, start_time), end_time = COALESCE($2, end_time),
          is_off = COALESCE($3, is_off), updated_at = now()
        WHERE tenant_id = $4 AND employee_id = $5 AND shift_date = $6 RETURNING *`,
          [body.start_time, body.end_time, body.is_off, tenantId, employeeId, shiftDate]
        );
      });
      if (res.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Override not found' });
      }

      logEvent(req, 'shift_override_updated', { tenantId, employeeId, date: shiftDate });
      return reply.send({ success: true, override: res.rows[0] });
    }, 'Failed to update shift override')
  );

  app.delete(
    '/shifts/overrides/:employeeId/:shiftDate',
    withHandler(async (req: AppRequest, reply) => {
      const { employeeId, shiftDate } = req.params as { employeeId: string; shiftDate: string };
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          `DELETE FROM employee_schedule
          WHERE tenant_id = $1 AND employee_id = $2 AND shift_date = $3
          RETURNING tenant_id`,
          [tenantId, employeeId, shiftDate]
        );
      });

      if (res.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Override not found' });
      }

      logEvent(req, 'shift_override_deleted', { tenantId, employeeId, date: shiftDate });
      return reply.send({ success: true });
    }, 'Failed to delete shift override')
  );

  app.post(
    '/shifts/copy-week',
    withHandler(async (req: AppRequest, reply) => {
      const parsed = CopyWeekSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }
      const { tenant_id, employee_id, source_start, target_start } = parsed.data;

      // Get effective shifts for the source week (7 days)
      const sourceEnd = new Date(source_start);
      sourceEnd.setDate(sourceEnd.getDate() + 6);
      const sourceEndStr = sourceEnd.toISOString().slice(0, 10);

      const effective = await withTenantClient(tenant_id, async (client) => {
        return client.query('SELECT * FROM get_effective_shifts($1, $2, $3::DATE, $4::DATE)', [
          tenant_id,
          employee_id,
          source_start,
          sourceEndStr,
        ]);
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
            `INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (tenant_id, employee_id, shift_date)
           DO UPDATE SET start_time = $4, end_time = $5, is_off = $6, updated_at = now()`,
            [tenant_id, employee_id, targetDateStr, row.start_time, row.end_time, row.is_off]
          );
          created++;
        }
      });

      logEvent(req, 'shifts_copied', {
        employeeId: employee_id,
        from: source_start,
        to: target_start,
        count: created,
      });
      return reply.send({ success: true, copied: created });
    }, 'Failed to copy week')
  );

  // POST /shifts/expand-weekly — fan out a caller-supplied weekly
  // pattern into N weeks of date-specific employee_schedule rows.
  // The setup wizard collects the weekly grid in form state and calls
  // this once at finalize. Idempotent — ON CONFLICT DO NOTHING
  // preserves any date-specific edits the owner already made.
  app.post(
    '/shifts/expand-weekly',
    withHandler(async (req: AppRequest, reply) => {
      const parsed = ExpandWeeklySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }
      const { tenant_id, employee_id, pattern, weeks_ahead } = parsed.data;

      const result = await withTenantClient(tenant_id, (client) =>
        expandWeeklyToSchedule(client, {
          tenantId: tenant_id,
          employeeId: employee_id,
          pattern,
          weeksAhead: weeks_ahead,
        })
      );

      logEvent(req, 'shifts_expanded_weekly', {
        employeeId: employee_id,
        patternDays: pattern.length,
        weeksAhead: weeks_ahead ?? 4,
        inserted: result.inserted,
      });
      return reply.send({ success: true, ...result });
    }, 'Failed to expand weekly schedule')
  );
}
