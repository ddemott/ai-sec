/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/no-explicit-any */
/**
 * ESLint rules disabled for this file as part of full cleanup (REFACTORING_TODO.md item 10).
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

// GDPR/CCPA erasure confirmation. The caller must echo the customer's CURRENT
// phone number — a typed confirmation (like GitHub's "type the repo name to
// delete") so an irreversible purge can't be a fat-finger on the wrong row.
const CustomerPurgeSchema = z.object({
  // Bounded like every other customer phone field (.max(30)); the DB also has a
  // (tenant_id, phone) unique constraint. Keeps an oversized payload out.
  confirm_phone: z.string().min(1).max(30),
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

      // Fire-and-forget CRM sync BEFORE DB delete (so sync can still read customer data if needed)
      syncCustomerToAll(pool, tenantId, id, 'delete', req.log);

      const res = await withTenantClient(tenantId, async (client) => {
        return client.query(
          'DELETE FROM customers WHERE customer_id = $1 AND tenant_id = $2 RETURNING customer_id',
          [id, tenantId]
        );
      });
      if (!assertRowAffected(res, reply, 'Customer')) return;

      logEvent(req, 'customer_deleted', { customerId: id });
      return reply.send({ success: true });
    }, 'Failed to delete customer')
  );

  // POST /customers/:id/purge — GDPR/CCPA "right to erasure" for one customer.
  //
  // Owner-only. Anonymizes the customer's PII IN PLACE instead of hard-deleting
  // the row, so appointment history, audit_log entries, and every FK that
  // points at customer_id stay referentially intact (a hard DELETE would either
  // cascade away business records or fail on the FK). After a purge the row
  // still exists but carries no personal data: name/email/address/etc. → NULL,
  // phone → an opaque tombstone (kept non-null + unique to satisfy the
  // (tenant_id, phone) constraint), metadata (which can hold free-text notes) → {}.
  //
  // The audit trigger on `customers` records to_jsonb(OLD) on every UPDATE, so
  // the anonymizing UPDATE would otherwise COPY the PII into audit_log.old_data
  // and defeat the erasure. We therefore also redact (NULL out) old_data/new_data
  // on every audit_log row for this customer — including the row this very
  // UPDATE just produced — keeping the who/when/action trail but dropping the
  // PII payload. (fn_audit_trigger is not attached to audit_log, so this redact
  // does not recursively audit.)
  //
  // SCOPE — deliberately tight, FLAGGED FOR LEGAL REVIEW before enabling in prod:
  // this erases the canonical customers row + its audit snapshots only. PII that
  // may ALSO live in voice_sessions.caller_phone, call transcripts, and
  // appointment descriptions is NOT scrubbed here — that involves
  // retention-vs-erasure tradeoffs (e.g. a legal hold on call recordings) that
  // need a human/legal decision. Tracked as a follow-up; do NOT represent this
  // as a complete GDPR erasure until that lands.
  //
  // RUNTIME KILL-SWITCH: the route is registered unconditionally but is INERT
  // unless ENABLE_CUSTOMER_PURGE === 'true'. So merging/deploying this PR cannot
  // ship a live, irreversible purge capability before legal sign-off — the
  // endpoint 404s (indistinguishable from "no such route") until explicitly
  // switched on.
  app.post(
    '/customers/:id/purge',
    withHandler(async (req: AppRequest, reply) => {
      // Kill-switch — disabled by default. 404 (not 403) so a probe can't even
      // tell the capability exists.
      if (process.env.ENABLE_CUSTOMER_PURGE !== 'true') {
        return reply.status(404).send({ success: false, error: 'Not found' });
      }

      const { id } = req.params as { id: string };
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      // Owner-only. Super-admin tenant bypasses for support operations.
      if (req.auth && req.auth.tenant_id !== SUPER_ADMIN_TENANT_ID && req.auth.role !== 'owner') {
        return reply
          .status(403)
          .send({ success: false, error: 'Only owners can erase customer data' });
      }

      const parsed = CustomerPurgeSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: "confirm_phone is required (must match the customer's current phone)",
        });
      }
      const confirmPhone = parsed.data.confirm_phone;
      const purgedBy = req.auth?.email ?? req.auth?.user_id ?? 'unknown';

      const outcome = await withTenantClient(tenantId, async (client) => {
        // The anonymize UPDATE and the audit_log redact MUST be atomic: the
        // customers audit trigger writes the pre-purge PII into
        // audit_log.old_data as part of the UPDATE, so if a concurrent
        // /audit-log read landed between two autocommit statements it could
        // observe that PII. Wrap both in one transaction; ROLLBACK on any
        // failure so we never half-erase.
        await client.query('BEGIN');
        try {
          // Lock the row + read the current phone for the typed-confirmation
          // check. FOR UPDATE closes the SELECT→UPDATE race (no one can change
          // the phone out from under us between the check and the write).
          const found = await client.query<{ phone: string }>(
            'SELECT phone FROM customers WHERE customer_id = $1 AND tenant_id = $2 FOR UPDATE',
            [id, tenantId]
          );
          if (found.rows.length === 0) {
            await client.query('ROLLBACK');
            return 'not_found' as const;
          }
          if (confirmPhone !== found.rows[0].phone) {
            await client.query('ROLLBACK');
            return 'mismatch' as const;
          }

          // Anonymize. phone → an opaque tombstone derived from the id (stays
          // unique within the tenant, obviously non-PII). is_deleted flips so it
          // drops out of every is_deleted=false read. The UPDATE is additionally
          // guarded on the phone we just read + must affect exactly one row.
          const upd = await client.query(
            `UPDATE customers
                SET name = NULL, email = NULL, address = NULL, address_line2 = NULL,
                    first_name = NULL, last_name = NULL, city = NULL, state = NULL,
                    postal_code = NULL, metadata = '{}'::jsonb,
                    phone = 'PURGED-' || customer_id::text,
                    is_deleted = true, deleted_at = now(), deleted_by = $3, updated_at = now()
              WHERE customer_id = $1 AND tenant_id = $2 AND phone = $4`,
            [id, tenantId, purgedBy, confirmPhone]
          );
          if (upd.rowCount === 0) {
            // Phone changed under us despite the lock, or the row vanished —
            // fail safe rather than report a success that didn't happen.
            await client.query('ROLLBACK');
            return 'race' as const;
          }

          // Redact the PII snapshots the audit trigger captured for this
          // customer — including the row the UPDATE above just produced. If this
          // touches ZERO rows the PII snapshot may still be present (trigger
          // missing, RLS misconfig, unexpected record_id shape): treat that as a
          // hard failure and ROLLBACK — privacy fails safe, not open.
          const redact = await client.query(
            `UPDATE audit_log
                SET old_data = NULL, new_data = NULL
              WHERE tenant_id = $1 AND table_name = 'customers' AND record_id = $2`,
            [tenantId, id]
          );
          if (redact.rowCount === 0) {
            await client.query('ROLLBACK');
            return 'audit_redact_failed' as const;
          }

          await client.query('COMMIT');
          return 'purged' as const;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      });

      if (outcome === 'not_found') {
        return reply.status(404).send({ success: false, error: 'Customer not found' });
      }
      if (outcome === 'mismatch') {
        return reply.status(400).send({
          success: false,
          error: 'Confirmation phone does not match this customer',
        });
      }
      if (outcome === 'race') {
        return reply.status(409).send({
          success: false,
          error: 'Customer changed during the purge; nothing was erased. Please retry.',
        });
      }
      if (outcome === 'audit_redact_failed') {
        return reply.status(500).send({
          success: false,
          error: 'Erasure aborted: could not redact the audit history. No data was changed.',
        });
      }

      // Best-effort: push the anonymized row to any connected CRM so an
      // integrated provider (e.g. Square) doesn't retain the pre-purge PII.
      // Fire-and-forget like the create/update/delete paths.
      syncCustomerToAll(pool, tenantId, id, 'update', req.log);

      logEvent(req, 'customer_purged_gdpr', { customerId: id, purgedBy });
      // Scope-accurate: this erases the customers record (+ its audit snapshots),
      // NOT every PII surface (transcripts/voice_sessions are out of scope).
      return reply.send({
        success: true,
        message: 'Customer record anonymized (personal data removed from the customer profile).',
      });
    }, 'Failed to erase customer data')
  );
}
