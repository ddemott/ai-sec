/**
 * Tenant data export — `GET /export/tenant-data`.
 *
 * Data-portability endpoint (GDPR Art. 20 / CCPA right-to-access): an owner can
 * download a machine-readable dump of everything their tenant owns — customers,
 * appointments, staff, schedule, services, call history/transcripts, comms,
 * reminders, consent records, knowledge base, AI-cost ledger.
 *
 * Design choices:
 * - JSON, not a ZIP of CSVs. JSON is fully portable, needs no new npm dependency
 *   (the repo intentionally ships no archiver/csv lib — "no deps on spec"), and
 *   is trivially testable. A ZIP/CSV packaging layer can come later if a real
 *   customer asks for spreadsheet-shaped output.
 * - Owner-only. This is a bulk PII export; front-desk users are rejected 403.
 *   The platform super-admin tenant bypasses (cross-tenant support).
 * - Tenant-scoped by RLS: every query runs inside `withTenantClient`, which sets
 *   `app.current_tenant_id`, and additionally filters `WHERE tenant_id = $1`.
 * - Security exclusions: `users` is column-restricted (NO password_hash);
 *   `tenant_integration_settings` (OAuth tokens/secrets), `phone_verifications`
 *   and `password_resets` (security tokens) are NOT exported. The owner re-auths
 *   integrations rather than receiving live credentials in a download.
 *
 * Scope note: this is the export half of the TODO "Data portability & retention"
 * item. GDPR/CCPA hard-purge, the retention/purge worker, and the owner-facing
 * audit-log view remain separate open items.
 */

import type { AppFastifyInstance } from '../types/fastify';
import type { Pool, PoolClient } from 'pg';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';

const SUPER_ADMIN_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Tenant-scoped tables exported verbatim (`SELECT *`). These are the owner's
 * own business + operational + compliance data. The list is hardcoded (table
 * names can't be parameterized) — every entry has a verified `tenant_id` column.
 * Deliberately excluded: tenant_integration_settings (secrets),
 * phone_verifications / password_resets (security tokens), schema_migrations /
 * business_templates (system), audit_log / record_versions (internal history —
 * surfaced by the separate audit-log view item).
 */
const EXPORT_TABLES = [
  'customers',
  'appointments',
  'employees',
  'resources',
  'services',
  'service_employee',
  'service_resource',
  'employee_schedule',
  'voice_sessions',
  'call_summaries',
  'call_transcripts',
  'communications_history',
  'message_delivery_status',
  'reminder_schedules',
  'consent_records',
  'opt_out_records',
  'customer_messages',
  'tenant_docs',
  'tenant_calendar_settings',
  'tenant_skills',
  'knowledge_suggestion',
  'unanswered_questions',
  'ai_cost_events',
  'user_feedback',
] as const;

export function registerExportRoutes(
  app: AppFastifyInstance,
  pool: Pool,
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>
) {
  app.get(
    '/export/tenant-data',
    withHandler(async (req: AppRequest, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;

      // Owner-only (super-admin tenant bypasses for cross-tenant support).
      // Bulk PII export must not be available to front-desk logins.
      if (req.auth && req.auth.tenant_id !== SUPER_ADMIN_TENANT_ID && req.auth.role !== 'owner') {
        return reply
          .status(403)
          .send({ success: false, error: 'Only owners can export tenant data' });
      }

      const { tables, counts } = await withTenantClient(tenantId, async (client) => {
        const out: Record<string, unknown[]> = {};
        const recordCounts: Record<string, number> = {};

        // users: safe columns only — never export password_hash or reset tokens.
        const usersRes = await client.query(
          `SELECT user_id, tenant_id, email, role, created_at
             FROM users WHERE tenant_id = $1 ORDER BY created_at`,
          [tenantId]
        );
        out.users = usersRes.rows;
        recordCounts.users = usersRes.rows.length;

        for (const table of EXPORT_TABLES) {
          const res = await client.query(`SELECT * FROM ${table} WHERE tenant_id = $1`, [tenantId]);
          out[table] = res.rows;
          recordCounts[table] = res.rows.length;
        }
        return { tables: out, counts: recordCounts };
      });

      const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);
      logEvent(req, 'tenant_data_exported', { tenantId, totalRecords });

      // Encourage a file download without forcing it (callers can still read JSON).
      void reply.header(
        'Content-Disposition',
        `attachment; filename="tenant-${tenantId}-export.json"`
      );
      return reply.send({
        success: true,
        tenant_id: tenantId,
        generated_at: new Date().toISOString(),
        record_counts: counts,
        total_records: totalRecords,
        tables,
      });
    }, 'Failed to export tenant data')
  );
}
