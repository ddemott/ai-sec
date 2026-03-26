
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { SUPER_ADMIN_TENANT_ID } from '../constants';
import { withHandler, logEvent, requireTenantId, withPoolClient, type AppRequest } from '../middleware';
import { syncAppointmentToCalendar } from '../services/calendarSync';
import { syncAppointmentToJobber } from '../services/jobberSync';
import { syncAppointmentToHubSpot } from '../services/hubspotSync';
import { syncAppointmentToSquare } from '../services/squareSync';
import { syncAppointmentToServiceTitan } from '../services/servicetitanSync';

const AppointmentCreateSchema = z.object({
  tenant_id: z.string().uuid(),
  resource_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  description: z.string().min(1).max(1000),
  location: z.string().max(500).optional().nullable(),
  employee_id: z.union([z.string(), z.number()]).optional().nullable(),
});

export function registerAppointmentRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.post('/appointments/create', withHandler(async (req: AppRequest, reply) => {
    const parsed = AppointmentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;

    const res = await withTenantClient(body.tenant_id, async (client) => {
      return client.query(
        'SELECT * FROM book_appointment_atomic($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [body.tenant_id, body.resource_id, body.customer_id, body.start_time, body.end_time,
         body.description, 'manual-entry', body.location || null,
         body.employee_id ? body.employee_id.toString() : null]
      );
    });
    const result = res.rows[0];
    if (result.success) {
      logEvent(req, 'appointment_created', { appointmentId: result.appointment_id });
      // Fire-and-forget sync — never blocks the response
      syncAppointmentToCalendar(pool, body.tenant_id, result.appointment_id, 'create').catch(() => {});
      syncAppointmentToJobber(pool, body.tenant_id, result.appointment_id, 'create').catch(() => {});
      syncAppointmentToHubSpot(pool, body.tenant_id, result.appointment_id, 'create').catch(() => {});
      syncAppointmentToSquare(pool, body.tenant_id, result.appointment_id, 'create').catch(() => {});
      syncAppointmentToServiceTitan(pool, body.tenant_id, result.appointment_id, 'create').catch(() => {});
      return reply.send({ success: true, appointment_id: result.appointment_id });
    } else {
      return reply.status(400).send({ success: false, error: result.error_message });
    }
  }, 'Failed to create appointment'));

  app.get('/appointments', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const limit = Math.min(parseInt((req.query as any)['limit']) || 200, 1000);
    const offset = parseInt((req.query as any)['offset']) || 0;
    const startDate = (req.query as any)['start_date'] || null;
    const endDate = (req.query as any)['end_date'] || null;

    const isSuperAdmin = tenantId === SUPER_ADMIN_TENANT_ID;

    // Build WHERE clauses and params dynamically for date filtering
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (!isSuperAdmin) {
      conditions.push(`a.tenant_id = $${paramIdx}`);
      params.push(tenantId);
      paramIdx++;
    }

    if (startDate) {
      conditions.push(`a.start_time >= $${paramIdx}`);
      params.push(startDate);
      paramIdx++;
    }

    if (endDate) {
      conditions.push(`a.start_time < $${paramIdx}`);
      params.push(endDate);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const baseQuery = `
      SELECT
         a.*,
         COALESCE(a.employee_id::text, a.assigned_to_user_id::text) as employee_id,
         jsonb_build_object(
           'name', c.name, 'first_name', c.first_name, 'last_name', c.last_name,
           'phone', c.phone, 'metadata', c.metadata
         ) AS customers,
         jsonb_build_object('name', r.name) AS resources
       FROM appointments a
       LEFT JOIN customers c ON c.id = a.customer_id
       LEFT JOIN resources r ON r.id = a.resource_id
       ${whereClause}
       ORDER BY a.start_time ASC`;

    if (isSuperAdmin) {
      params.push(limit, offset);
      return withPoolClient(pool, async (client) => {
        const res = await client.query(`${baseQuery} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`, params);
        return reply.send(res.rows);
      });
    }

    params.push(limit, offset);
    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(`${baseQuery} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`, params);
    });
    return reply.send(res.rows);
  }, 'Failed to fetch appointments'));

  app.delete('/appointments/:id', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    // Sync delete before removing from DB
    syncAppointmentToCalendar(pool, tenantId, id, 'delete').catch(() => {});
    syncAppointmentToJobber(pool, tenantId, id, 'delete').catch(() => {});
    syncAppointmentToHubSpot(pool, tenantId, id, 'delete').catch(() => {});
    syncAppointmentToSquare(pool, tenantId, id, 'delete').catch(() => {});
    syncAppointmentToServiceTitan(pool, tenantId, id, 'delete').catch(() => {});

    await withTenantClient(tenantId, async (client) => {
      await client.query('DELETE FROM appointments WHERE id = $1', [id]);
    });

    logEvent(req, 'appointment_deleted', { appointmentId: id });
    return reply.send({ success: true });
  }, 'Failed to delete appointment'));

  // POST /appointments/:id/cancel - soft cancel (status update, not delete)
  app.post('/appointments/:id/cancel', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        "UPDATE appointments SET status = 'canceled' WHERE id = $1 AND tenant_id = $2 RETURNING id",
        [id, tenantId]
      );
    });
    if (res.rows.length === 0) {
      return reply.status(404).send({ success: false, error: 'Appointment not found' });
    }

    logEvent(req, 'appointment_canceled', { appointmentId: id });
    // Remove from calendars/CRMs — canceled appointments shouldn't block the slot
    syncAppointmentToCalendar(pool, tenantId, id, 'delete').catch(() => {});
    syncAppointmentToJobber(pool, tenantId, id, 'delete').catch(() => {});
    syncAppointmentToHubSpot(pool, tenantId, id, 'delete').catch(() => {});
    syncAppointmentToSquare(pool, tenantId, id, 'delete').catch(() => {});
    syncAppointmentToServiceTitan(pool, tenantId, id, 'delete').catch(() => {});
    return reply.send({ success: true });
  }, 'Failed to cancel appointment'));

  app.post('/appointments/:id/update', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      tenant_id: string; start_time: string; end_time: string; description: string;
      location: string; resource_id: string; employee_id: string | number | null;
      customer_name: string; customer_phone: string; customer_notes: string;
    };

    await withTenantClient(body.tenant_id, async (client) => {
      // Direct UPDATE instead of RPC — avoids integer/UUID type mismatch
      // on the overloaded update_appointment_customer functions
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (body.start_time) { fields.push(`start_time = $${idx}`); values.push(body.start_time); idx++; }
      if (body.end_time) { fields.push(`end_time = $${idx}`); values.push(body.end_time); idx++; }
      if (body.description !== undefined) { fields.push(`description = $${idx}`); values.push(body.description); idx++; }
      if (body.location !== undefined) { fields.push(`location = $${idx}`); values.push(body.location || null); idx++; }
      if (body.resource_id) { fields.push(`resource_id = $${idx}`); values.push(body.resource_id); idx++; }
      if (body.employee_id !== undefined) {
        fields.push(`employee_id = $${idx}`);
        values.push(body.employee_id ? body.employee_id.toString() : null);
        idx++;
      }

      if (fields.length === 0) {
        return { rows: [{ success: true }] };
      }

      values.push(id); // WHERE id = $N
      values.push(body.tenant_id); // AND tenant_id = $N+1
      await client.query(
        `UPDATE appointments SET ${fields.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1}`,
        values
      );

      // Update customer info if provided
      if (body.customer_name || body.customer_phone || body.customer_notes) {
        const appt = await client.query('SELECT customer_id FROM appointments WHERE id = $1', [id]);
        if (appt.rows[0]?.customer_id) {
          const custFields: string[] = [];
          const custValues: unknown[] = [];
          let ci = 1;
          if (body.customer_name) { custFields.push(`name = $${ci}`); custValues.push(body.customer_name); ci++; }
          if (body.customer_phone) { custFields.push(`phone = $${ci}`); custValues.push(body.customer_phone); ci++; }
          if (body.customer_notes !== undefined) { custFields.push(`metadata = jsonb_set(COALESCE(metadata, '{}'), '{notes}', $${ci}::jsonb)`); custValues.push(JSON.stringify(body.customer_notes)); ci++; }
          if (custFields.length > 0) {
            custValues.push(appt.rows[0].customer_id);
            await client.query(`UPDATE customers SET ${custFields.join(', ')} WHERE id = $${ci}`, custValues);
          }
        }
      }

      return { rows: [{ success: true }] };
    });

    logEvent(req, 'appointment_updated', { appointmentId: id });
    // Sync update to calendars/CRMs
    syncAppointmentToCalendar(pool, body.tenant_id, id, 'update').catch(() => {});
    syncAppointmentToJobber(pool, body.tenant_id, id, 'update').catch(() => {});
    syncAppointmentToHubSpot(pool, body.tenant_id, id, 'update').catch(() => {});
    syncAppointmentToSquare(pool, body.tenant_id, id, 'update').catch(() => {});
    syncAppointmentToServiceTitan(pool, body.tenant_id, id, 'update').catch(() => {});
    return reply.send({ success: true });
  }, 'Failed to update appointment'));
}
