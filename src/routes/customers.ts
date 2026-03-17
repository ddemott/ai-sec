
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { SUPER_ADMIN_TENANT_ID } from '../constants';

const CustomerCreateSchema = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  phone: z.string().min(1).max(30),
  email: z.string().email().optional().nullable(),
  first_name: z.string().max(100).optional().nullable(),
  last_name: z.string().max(100).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  address_line2: z.string().max(500).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  postal_code: z.string().max(20).optional().nullable(),
  timezone: z.string().max(50).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export function registerCustomerRoutes(
  app: any,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get('/customers', async (req, reply) => {
    const tenantId = (req.query as any)['tenant_id'];
    const limit = Math.min(parseInt((req.query as any)['limit']) || 200, 1000);
    const offset = parseInt((req.query as any)['offset']) || 0;

    if (!tenantId) {
      return reply.status(400).send({ error: 'tenant_id is required' });
    }

    const isSuperAdmin = tenantId === SUPER_ADMIN_TENANT_ID;

    try {
      if (isSuperAdmin) {
        const client = await pool.connect();
        try {
          const res = await client.query('SELECT * FROM customers ORDER BY name LIMIT $1 OFFSET $2', [limit, offset]);
          return reply.send(res.rows);
        } finally {
          client.release();
        }
      } else {
        const res = await withTenantClient(tenantId, async (client) => {
          return client.query('SELECT * FROM customers WHERE tenant_id = $1 ORDER BY name LIMIT $2 OFFSET $3', [tenantId, limit, offset]);
        });
        return reply.send(res.rows);
      }
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch customers' });
    }
  });

  app.post('/customers/create', async (req, reply) => {
    const parsed = CustomerCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;

    try {
      const res = await withTenantClient(body.tenant_id, async (client) => {
        return client.query(
          `INSERT INTO customers (
             tenant_id, name, phone, email, address, address_line2,
             city, state, postal_code, metadata, first_name, last_name, timezone
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [body.tenant_id, body.name, body.phone, body.email || null,
           body.address || null, body.address_line2 || null, body.city || null,
           body.state || null, body.postal_code || null, body.metadata || {},
           body.first_name || null, body.last_name || null, body.timezone || 'America/New_York']
        );
      });
      return reply.send({ success: true, customer: res.rows[0] });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to create customer' });
    }
  });

  app.put('/customers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const tenantId = body.tenant_id || (req as any).auth?.tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      await withTenantClient(tenantId, async (client) => {
        await client.query(
          `UPDATE customers SET
             first_name = $1, last_name = $2, name = $3, phone = $4, email = $5,
             address = $6, address_line2 = $7, city = $8, state = $9,
             postal_code = $10, metadata = $11, timezone = $12
           WHERE id = $13`,
          [body.first_name || null, body.last_name || null, body.name || null,
           body.phone, body.email, body.address, body.address_line2 || null,
           body.city || null, body.state || null, body.postal_code || null,
           body.metadata || {}, body.timezone || 'America/New_York', id]
        );
      });
      return reply.send({ success: true });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to update customer' });
    }
  });

  // GET /customers/:id/appointments - all appointments for a specific customer
  app.get('/customers/:id/appointments', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = (req.query as any).tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          `SELECT a.id, a.start_time, a.end_time, a.status, a.description, a.location,
                  r.name as resource_name,
                  e.name as employee_name
           FROM appointments a
           LEFT JOIN resources r ON r.id = a.resource_id
           LEFT JOIN employees e ON e.id = a.employee_id
           WHERE a.customer_id = $1 AND a.tenant_id = $2
           ORDER BY a.start_time DESC`,
          [id, tenantId]
        );
      });
      return reply.send(res.rows);
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to fetch customer appointments' });
    }
  });

  app.delete('/customers/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = (req.query as any).tenant_id || (req as any).auth?.tenant_id;
    if (!tenantId) return reply.status(400).send({ error: 'tenant_id is required' });

    try {
      await withTenantClient(tenantId, async (client) => {
        await client.query('DELETE FROM customers WHERE id = $1', [id]);
      });
      return reply.send({ success: true });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({ error: 'Failed to delete customer' });
    }
  });
}
