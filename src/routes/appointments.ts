
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { SUPER_ADMIN_TENANT_ID } from '../constants';

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
  app.post('/appointments/create', async (req, reply) => {
    const parsed = AppointmentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;

    try {
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
        return reply.send({ success: true, appointment_id: result.appointment_id });
      } else {
        return reply.status(400).send({ success: false, error: result.error_message });
      }
    } catch (err: any) {
      if (err instanceof Error && (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND') throw err;
      app.log.error(err);
      if (err.code === '22P02') {
        return reply.status(400).send({ success: false, error: 'Invalid identifier or time format', detail: err.detail });
      }
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.get('/appointments', async (req, reply) => {
    const tenantId = (req.query as any)['tenant_id'];
    const limit = Math.min(parseInt((req.query as any)['limit']) || 200, 1000);
    const offset = parseInt((req.query as any)['offset']) || 0;
    const startDate = (req.query as any)['start_date'] || null;
    const endDate = (req.query as any)['end_date'] || null;

    if (!tenantId) {
      return reply.status(400).send({ error: 'tenant_id is required' });
    }

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

    try {
      if (isSuperAdmin) {
        const client = await pool.connect();
        try {
          params.push(limit, offset);
          const res = await client.query(`${baseQuery} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`, params);
          return reply.send(res.rows);
        } finally {
          client.release();
        }
      } else {
        params.push(limit, offset);
        const res = await withTenantClient(tenantId, async (client) => {
          return client.query(`${baseQuery} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`, params);
        });
        return reply.send(res.rows);
      }
    } catch (err) {
      if (err instanceof Error && (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND') throw err;
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch appointments' });
    }
  });

  app.delete('/appointments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = (req.query as any).tenant_id || (req as any).auth?.tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      await withTenantClient(tenantId, async (client) => {
        await client.query('DELETE FROM appointments WHERE id = $1', [id]);
      });
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof Error && (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND') throw err;
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to delete appointment' });
    }
  });

  // POST /appointments/:id/cancel - soft cancel (status update, not delete)
  app.post('/appointments/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { tenant_id?: string };
    const tenantId = body.tenant_id || (req as any).auth?.tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          "UPDATE appointments SET status = 'canceled' WHERE id = $1 AND tenant_id = $2 RETURNING id",
          [id, tenantId]
        );
      });
      if (res.rows.length === 0) {
        return reply.status(404).send({ success: false, error: 'Appointment not found' });
      }
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof Error && (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND') throw err;
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to cancel appointment' });
    }
  });

  app.post('/appointments/:id/update', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as {
      tenant_id: string; start_time: string; end_time: string; description: string;
      location: string; resource_id: string; employee_id: string | number | null;
      customer_name: string; customer_phone: string; customer_notes: string;
    };

    try {
      const res = await withTenantClient(body.tenant_id, async (client) => {
        return client.query(
          'SELECT * FROM update_appointment_customer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
          [id, body.tenant_id, body.start_time, body.end_time, body.description,
           body.location, body.resource_id, body.employee_id ? body.employee_id.toString() : null,
           body.customer_name, body.customer_phone, body.customer_notes]
        );
      });
      const result = res.rows[0];
      if (result.success) {
        return reply.send({ success: true });
      } else {
        return reply.status(400).send({ success: false, error: result.error_message });
      }
    } catch (err) {
      if (err instanceof Error && (err as unknown as { code?: string }).code === 'TENANT_NOT_FOUND') throw err;
      app.log.error(err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
