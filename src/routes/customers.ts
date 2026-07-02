/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of historical full cleanup (REFACTORING_TODO item 10; see RESOLVED.md for details).
 * These are the remaining dynamic/any-heavy areas after previous tranches.
 */

import type { AppFastifyInstance } from '../types/fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { SUPER_ADMIN_TENANT_ID } from '../constants';
import {
  withHandler,
  logEvent,
  requireTenantId,
  withPoolClient,
  type AppRequest,
} from '../middleware';
import { syncAppointmentToAll, syncCustomerToAll } from '../services/syncOrchestrator';
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
  // Optional convenience (folded into metadata by handler, like update path).
  notes: z.string().max(2000).optional().nullable(),
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
  // Top-level convenience field used by CRMView (Internal Notes textarea)
  // and E2E tests. Folded into metadata.notes by the handler below so the
  // value ends up in the canonical customers.metadata.notes location used
  // by the booking path and the voice agent context.
  notes: z.string().max(2000).optional().nullable(),
});

export function registerCustomerRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get(
    '/customers',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      const query = req.query as Record<string, string | undefined>;
      const limit = Math.min(parseInt(query['limit'] ?? '') || 200, 1000);
      const offset = parseInt(query['offset'] ?? '') || 0;

      if (tenantId === SUPER_ADMIN_TENANT_ID) {
        const res = await withPoolClient(pool, (client) =>
          client.query(
            'SELECT * FROM customers WHERE is_deleted = false ORDER BY name LIMIT $1 OFFSET $2',
            [limit, offset]
          )
        );
        return reply.send(res.rows);
      }

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          'SELECT * FROM customers WHERE tenant_id = $1 AND is_deleted = false ORDER BY name LIMIT $2 OFFSET $3',
          [tenantId, limit, offset]
        );
      });
      return reply.send(res.rows);
    }, 'Failed to fetch customers')
  );

  app.post(
    '/customers/create',
    withHandler(async (req: AppRequest, reply) => {
      const parsed = CustomerCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }
      const body = parsed.data;

      // Fold optional top-level notes into metadata for the canonical storage location.
      const createMetadata =
        body.notes !== undefined
          ? { ...(body.metadata || {}), notes: body.notes }
          : body.metadata || {};

      const res = await withTenantClient(body.tenant_id, async (client) => {
        return client.query(
          `INSERT INTO customers (
           tenant_id, name, phone, email, address, address_line2,
           city, state, postal_code, metadata, first_name, last_name, timezone
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [
            body.tenant_id,
            body.name,
            body.phone,
            body.email || null,
            body.address || null,
            body.address_line2 || null,
            body.city || null,
            body.state || null,
            body.postal_code || null,
            createMetadata,
            body.first_name || null,
            body.last_name || null,
            body.timezone || 'America/New_York',
          ]
        );
      });

      logEvent(req, 'customer_created', { customerId: res.rows[0].customer_id, name: body.name });
      // Fire-and-forget CRM sync
      syncCustomerToAll(pool, body.tenant_id, res.rows[0].customer_id, 'create', req.log);
      return reply.send({ success: true, customer: res.rows[0] });
    }, 'Failed to create customer')
  );

  app.put(
    '/customers/:id',
    withHandler(async (req: AppRequest, reply) => {
      const { id } = req.params as { id: string };
      const parsed = CustomerUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ success: false, error: 'Validation failed', details: parsed.error.issues });
      }
      const body = parsed.data;
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      const res = await withTenantClient(tenantId, async (client) => {
        // Read current row first so we can support partial patches (e.g. the
        // E2E test helper that sends only {tenant_id, notes}) and the real
        // UI path that sends a mix of current field values + top-level notes.
        // Without this, omitting fields would null them out (data corruption).
        const currentQ = await client.query(
          `SELECT name, phone, email, first_name, last_name, address, address_line2,
                  city, state, postal_code, metadata, timezone
             FROM customers
            WHERE customer_id = $1 AND tenant_id = $2`,
          [id, tenantId]
        );
        if (currentQ.rowCount === 0) {
          return { rowCount: 0 } as any;
        }
        const cur = currentQ.rows[0];

        // Merge notes convenience field into metadata (preserve other keys).
        let finalMetadata: Record<string, unknown> =
          body.metadata !== undefined
            ? (body.metadata as Record<string, unknown>)
            : cur.metadata || {};
        if (body.notes !== undefined) {
          finalMetadata = { ...finalMetadata, notes: body.notes };
        }

        // Use COALESCE-style preservation for omitted scalar fields (partial update safety).
        const finalName = body.name !== undefined ? body.name : cur.name;
        const finalPhone = body.phone !== undefined ? body.phone : cur.phone;
        const finalEmail = body.email !== undefined ? body.email : cur.email;
        const finalFirst = body.first_name !== undefined ? body.first_name : cur.first_name;
        const finalLast = body.last_name !== undefined ? body.last_name : cur.last_name;
        const finalAddr = body.address !== undefined ? body.address : cur.address;
        const finalAddr2 =
          body.address_line2 !== undefined ? body.address_line2 : cur.address_line2;
        const finalCity = body.city !== undefined ? body.city : cur.city;
        const finalState = body.state !== undefined ? body.state : cur.state;
        const finalPostal = body.postal_code !== undefined ? body.postal_code : cur.postal_code;
        const finalTz =
          body.timezone !== undefined ? body.timezone : cur.timezone || 'America/New_York';

        return client.query(
          `UPDATE customers SET
             first_name = $1, last_name = $2, name = $3, phone = $4, email = $5,
             address = $6, address_line2 = $7, city = $8, state = $9,
             postal_code = $10, metadata = $11, timezone = $12
           WHERE customer_id = $13 AND tenant_id = $14 RETURNING customer_id`,
          [
            finalFirst || null,
            finalLast || null,
            finalName || null,
            finalPhone,
            finalEmail,
            finalAddr,
            finalAddr2 || null,
            finalCity || null,
            finalState || null,
            finalPostal || null,
            finalMetadata,
            finalTz,
            id,
            tenantId,
          ]
        );
      });
      if (!assertRowAffected(res, reply, 'Customer')) return;

      logEvent(req, 'customer_updated', { customerId: id });
      // Fire-and-forget CRM sync
      syncCustomerToAll(pool, tenantId, id, 'update', req.log);
      return reply.send({ success: true });
    }, 'Failed to update customer')
  );

  // GET /customers/:id/appointments - all appointments for a specific customer
  app.get(
    '/customers/:id/appointments',
    withHandler(async (req: AppRequest, reply) => {
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
    }, 'Failed to fetch customer appointments')
  );

  app.delete(
    '/customers/:id',
    withHandler(async (req: AppRequest, reply) => {
      const { id } = req.params as { id: string };
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      // Soft-delete (set is_deleted) rather than a hard DELETE. A hard delete
      // (a) failed with a 23503 FK violation whenever the customer had
      // customer_messages / job_inquiries rows (those FKs are NO ACTION), which
      // surfaced to the owner as "deleting customers isn't working", and (b) even
      // when it succeeded it CASCADE-removed the customer's appointments +
      // call_summaries, destroying history. Soft-delete hides the customer from
      // every list (they all filter is_deleted = false) while preserving records.
      const deletedBy = req.auth?.email ?? 'user';
      // Soft-delete + upcoming-cancel in ONE transaction. The list/schedule
      // queries join customers WHERE is_deleted = false, so a deleted
      // customer's future 'scheduled' rows would become INVISIBLE while still
      // holding their slot (they feed the GiST exclusion constraints) — an
      // unbookable, uncancelable ghost. Cancel the upcoming ones (frees the
      // slot); keep past/completed for history/analytics.
      const { res, canceledAppointments } = await withTenantClient(tenantId, async (client) => {
        await client.query('BEGIN');
        try {
          const del = await client.query(
            `UPDATE customers
                SET is_deleted = true, deleted_at = now(), deleted_by = $3
              WHERE customer_id = $1 AND tenant_id = $2 AND is_deleted = false
              RETURNING customer_id`,
            [id, tenantId, deletedBy]
          );
          let canceled: string[] = [];
          if (del.rows.length > 0) {
            const c = await client.query<{ appointment_id: string }>(
              `UPDATE appointments
                  SET status = 'canceled'
                WHERE customer_id = $1 AND tenant_id = $2
                  AND status = 'scheduled'
                  AND start_time > now()
                  AND (is_deleted IS NULL OR is_deleted = false)
                RETURNING appointment_id`,
              [id, tenantId]
            );
            canceled = c.rows.map((r) => r.appointment_id);
          }
          await client.query('COMMIT');
          return { res: del, canceledAppointments: canceled };
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      });
      if (!assertRowAffected(res, reply, 'Customer')) return;

      // Fire-and-forget CRM sync AFTER confirming a row was actually soft-deleted
      // — otherwise a 404 (missing / already-deleted customer) would still
      // dispatch a spurious delete to the CRM. Safe to run after the write
      // because soft-delete leaves the row readable (unlike the old hard DELETE,
      // which forced the sync to run first).
      syncCustomerToAll(pool, tenantId, id, 'delete', req.log);
      // Mirror POST /appointments/:id/cancel: a canceled appointment must also
      // leave external calendars/CRMs so the slot frees everywhere.
      for (const apptId of canceledAppointments) {
        syncAppointmentToAll(pool, tenantId, apptId, 'delete', req.log);
      }

      logEvent(req, 'customer_deleted', {
        customerId: id,
        canceledAppointments: canceledAppointments.length,
      });
      return reply.send({ success: true });
    }, 'Failed to delete customer')
  );
}
