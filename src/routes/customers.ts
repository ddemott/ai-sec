
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { SUPER_ADMIN_TENANT_ID } from '../constants';
import { withHandler, logEvent, requireTenantId, withPoolClient, type AppRequest } from '../middleware';
import { syncCustomerToAll } from '../services/syncOrchestrator';
import { assertRowAffected } from './routeHelpers';

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

const CustomerUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().min(1).max(30).optional(),
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
  app: FastifyInstance<any, any, any>,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get('/customers', withHandler(async (req: AppRequest, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const limit = Math.min(parseInt((req.query as any)['limit']) || 200, 1000);
    const offset = parseInt((req.query as any)['offset']) || 0;

    if (tenantId === SUPER_ADMIN_TENANT_ID) {
      const res = await withPoolClient(pool, (client) =>
        client.query('SELECT * FROM customers WHERE is_deleted = false ORDER BY name LIMIT $1 OFFSET $2', [limit, offset])
      );
      return reply.send(res.rows);
    }

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query('SELECT * FROM customers WHERE tenant_id = $1 AND is_deleted = false ORDER BY name LIMIT $2 OFFSET $3', [tenantId, limit, offset]);
    });
    return reply.send(res.rows);
  }, 'Failed to fetch customers'));

  app.post('/customers/create', withHandler(async (req: AppRequest, reply) => {
    const parsed = CustomerCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;

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

    logEvent(req, 'customer_created', { customerId: res.rows[0].id, name: body.name });
    // Fire-and-forget CRM sync
    syncCustomerToAll(pool, body.tenant_id, res.rows[0].id, 'create', req.log);
    return reply.send({ success: true, customer: res.rows[0] });
  }, 'Failed to create customer'));

  app.put('/customers/:id', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const parsed = CustomerUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Validation failed', details: parsed.error.issues });
    }
    const body = parsed.data;
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        `UPDATE customers SET
           first_name = $1, last_name = $2, name = $3, phone = $4, email = $5,
           address = $6, address_line2 = $7, city = $8, state = $9,
           postal_code = $10, metadata = $11, timezone = $12
         WHERE id = $13 AND tenant_id = $14 RETURNING id`,
        [body.first_name || null, body.last_name || null, body.name || null,
         body.phone, body.email, body.address, body.address_line2 || null,
         body.city || null, body.state || null, body.postal_code || null,
         body.metadata || {}, body.timezone || 'America/New_York', id, tenantId]
      );
    });
    if (!assertRowAffected(res, reply, 'Customer')) return;

    logEvent(req, 'customer_updated', { customerId: id });
    // Fire-and-forget CRM sync
    syncCustomerToAll(pool, tenantId, id, 'update', req.log);
    return reply.send({ success: true });
  }, 'Failed to update customer'));

  // GET /customers/:id/appointments - all appointments for a specific customer
  app.get('/customers/:id/appointments', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query(
        `SELECT a.appointment_id, a.start_time, a.end_time, a.status, a.description, a.location,
                r.name as resource_name,
                e.name as employee_name
         FROM appointments a
         LEFT JOIN resources r ON r.resource_id = a.resource_id
         LEFT JOIN employees e ON e.employee_id = a.employee_id
         WHERE a.customer_id = $1 AND a.tenant_id = $2 AND a.is_deleted = false
         ORDER BY a.start_time DESC`,
        [id, tenantId]
      );
    });
    return reply.send(res.rows);
  }, 'Failed to fetch customer appointments'));

  app.delete('/customers/:id', withHandler(async (req: AppRequest, reply) => {
    const { id } = req.params as { id: string };
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;

    // Fire-and-forget CRM sync BEFORE DB delete (so sync can still read customer data if needed)
    syncCustomerToAll(pool, tenantId, id, 'delete', req.log);

    const res = await withTenantClient(tenantId, async (client) => {
      return client.query('DELETE FROM customers WHERE id = $1 AND tenant_id = $2 RETURNING id', [id, tenantId]);
    });
    if (!assertRowAffected(res, reply, 'Customer')) return;

    logEvent(req, 'customer_deleted', { customerId: id });
    return reply.send({ success: true });
  }, 'Failed to delete customer'));
}
