/**
 * Owner-facing audit-log view — `GET /audit-log`.
 *
 * Read-only, owner-gated window onto the tenant's `audit_log` table (written by
 * the SECURITY DEFINER `fn_audit_trigger` on appointments / customers /
 * resources). Lets an owner answer "who changed this booking, and when?"
 * without DB access.
 *
 * - Owner-only: change history can expose old/new field values (PII); front-desk
 *   logins are rejected 403. The super-admin tenant bypasses for support.
 * - Tenant-scoped by RLS (`withTenantClient`) AND an explicit `tenant_id = $1`.
 * - Paginated (limit/offset) + optional `table_name` filter + optional date
 *   range, newest first.
 *
 * Part of the "Data portability & retention" TODO item (the audit-log view
 * sub-part). The GDPR/CCPA hard-purge + retention worker remain separate items.
 */

import type { AppFastifyInstance } from '../types/fastify';
import type { Pool, PoolClient } from 'pg';
import { withHandler, requireTenantId, type AppRequest } from '../middleware';
import { parsePagination, parseDateRange } from './routeHelpers';
import { SUPER_ADMIN_TENANT_ID } from '../constants';

/** Tables the audit trigger actually writes — used to validate the filter. */
const AUDITED_TABLES = new Set(['appointments', 'customers', 'resources']);

export function registerAuditLogRoutes(
  app: AppFastifyInstance,
  _pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get(
    '/audit-log',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      // Owner-only (super-admin tenant bypasses). Change history can reveal
      // old/new PII field values, so front-desk logins can't read it.
      if (req.auth && req.auth.tenant_id !== SUPER_ADMIN_TENANT_ID && req.auth.role !== 'owner') {
        return reply
          .status(403)
          .send({ success: false, error: 'Only owners can view the audit log' });
      }

      const query = req.query as Record<string, string>;
      const { limit, offset } = parsePagination(query, { limit: 100, maxLimit: 500 });

      // Build the filtered, parameterized query. tenant_id is always $1.
      const conditions = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];

      const tableFilter = query.table_name;
      if (tableFilter) {
        if (!AUDITED_TABLES.has(tableFilter)) {
          return reply.status(400).send({
            success: false,
            error: `Invalid table_name. Audited tables: ${[...AUDITED_TABLES].join(', ')}`,
          });
        }
        params.push(tableFilter);
        conditions.push(`table_name = $${params.length}`);
      }

      // Optional date range. parseDateRange defaults start_date to today; only
      // apply the start bound when the caller actually passed one.
      if (query.start_date) {
        const { startDate, endDate } = parseDateRange(query);
        params.push(startDate);
        conditions.push(`created_at >= $${params.length}::date`);
        if (endDate) {
          params.push(endDate);
          // end_date is inclusive → compare against the next midnight.
          conditions.push(`created_at < ($${params.length}::date + interval '1 day')`);
        }
      }

      params.push(limit);
      const limitIdx = params.length;
      params.push(offset);
      const offsetIdx = params.length;

      const sql = `SELECT audit_log_id, tenant_id, table_name, record_id, action,
                          old_data, new_data, changed_by, created_at
                     FROM audit_log
                    WHERE ${conditions.join(' AND ')}
                    ORDER BY created_at DESC
                    LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

      const res = await withTenantClient(tenantId, async (client) => client.query(sql, params));

      return reply.send({
        success: true,
        entries: res.rows,
        count: res.rows.length,
        limit,
        offset,
      });
    }, 'Failed to fetch audit log')
  );
}
