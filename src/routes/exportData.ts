/**
 * Tenant data export — `GET /export/tenant-data`.
 *
 * Data-portability endpoint (GDPR Art. 20 / CCPA right-to-access): an owner can
 * download a machine-readable dump of everything their tenant owns — customers,
 * appointments, staff, schedule, services, call history/transcripts, comms,
 * reminders, consent records, knowledge base, AI-cost ledger.
 *
 * Also here: the spreadsheet-shaped CSV exports (2026-07-04) —
 * `GET /export/{customers,appointments,calls}.csv` — curated column sets with
 * hand-rolled RFC-4180 escaping + formula-injection guard (src/services/csv.ts).
 *
 * Design choices:
 * - The full dump is JSON, not a ZIP of CSVs. JSON is fully portable, needs no
 *   new npm dependency (the repo intentionally ships no archiver/csv lib —
 *   "no deps on spec"), and is trivially testable. The per-entity CSV routes
 *   cover the spreadsheet-shaped use case.
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
import type { FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { withHandler, logEvent, requireTenantId, type AppRequest } from '../middleware';
import { toCsv } from '../services/csv';

const SUPER_ADMIN_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Owner gate shared by every bulk export. Front-desk logins must never bulk-
 * export PII; the platform super-admin tenant bypasses (cross-tenant support).
 * Returns false after sending the 403 so callers can `if (!...) return;`.
 */
function requireOwnerForExport(req: AppRequest, reply: FastifyReply): boolean {
  if (req.auth && req.auth.tenant_id !== SUPER_ADMIN_TENANT_ID && req.auth.role !== 'owner') {
    void reply.status(403).send({ success: false, error: 'Only owners can export tenant data' });
    return false;
  }
  return true;
}

/**
 * CSV exports — spreadsheet-shaped counterparts to the JSON dump below
 * (docs/GAPS.md §6 "no bulk operations (CSV import/export)" / §16 "rich
 * exports"). Each returns a curated, human-usable column set — not a raw
 * `SELECT *` — excluding soft-deleted rows the same way the list routes do.
 * RFC-4180 escaping + spreadsheet formula-injection guard live in
 * src/services/csv.ts (hand-rolled; no new npm dependency).
 */
const CSV_EXPORTS: Record<
  string,
  { filename: string; header: string[]; sql: string; event: string }
> = {
  customers: {
    filename: 'customers',
    event: 'customers_csv_exported',
    header: [
      'name',
      'first_name',
      'last_name',
      'phone',
      'email',
      'address',
      'city',
      'state',
      'postal_code',
      'timezone',
      'notes',
      'created_at',
    ],
    sql: `SELECT c.name, c.first_name, c.last_name, c.phone, c.email,
                 c.address, c.city, c.state, c.postal_code, c.timezone,
                 c.metadata->>'notes' AS notes, c.created_at
            FROM customers c
           WHERE c.tenant_id = $1 AND c.is_deleted = false
           ORDER BY c.name NULLS LAST, c.created_at`,
  },
  appointments: {
    filename: 'appointments',
    event: 'appointments_csv_exported',
    header: [
      'start_time',
      'end_time',
      'status',
      'service',
      'employee',
      'resource',
      'customer',
      'customer_phone',
      'location',
      'created_at',
    ],
    sql: `SELECT a.start_time, a.end_time, a.status,
                 COALESCE(s.name, a.description) AS service,
                 e.name AS employee, r.name AS resource,
                 c.name AS customer, c.phone AS customer_phone,
                 a.location, a.created_at
            FROM appointments a
            LEFT JOIN services s ON s.service_id = a.service_id
            LEFT JOIN employees e ON e.employee_id = a.employee_id
            LEFT JOIN resources r ON r.resource_id = a.resource_id
            LEFT JOIN customers c ON c.customer_id = a.customer_id
           WHERE a.tenant_id = $1 AND a.is_deleted = false
           ORDER BY a.start_time DESC`,
  },
  calls: {
    filename: 'calls',
    event: 'calls_csv_exported',
    header: [
      'started_at',
      'ended_at',
      'duration_seconds',
      'caller_phone',
      'customer',
      'status',
      'outcome',
      'summary',
    ],
    // voice_sessions.is_deleted is nullable (DEFAULT false, no NOT NULL) —
    // IS NOT TRUE keeps legacy NULL rows visible, matching the calls views.
    sql: `SELECT v.started_at, v.ended_at, v.duration_seconds,
                 v.caller_phone, c.name AS customer,
                 v.status, v.outcome, v.summary
            FROM voice_sessions v
            LEFT JOIN customers c ON c.customer_id = v.customer_id
           WHERE v.tenant_id = $1 AND v.is_deleted IS NOT TRUE
           ORDER BY v.started_at DESC`,
  },
};

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
      if (!requireOwnerForExport(req, reply)) return;

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

  // GET /export/{customers,appointments,calls}.csv — spreadsheet exports.
  // Success returns text/csv (attachment); failures keep the standard JSON
  // { success: false, error } shape (401/403 come from the shared gates).
  for (const [kind, spec] of Object.entries(CSV_EXPORTS)) {
    app.get(
      `/export/${kind}.csv`,
      withHandler(async (req: AppRequest, reply) => {
        const tenantId = requireTenantId(req, reply);
        if (!tenantId) return;
        if (!requireOwnerForExport(req, reply)) return;

        const res = await withTenantClient(tenantId, (client) =>
          client.query(spec.sql, [tenantId])
        );
        const rows = res.rows.map((row: Record<string, unknown>) =>
          spec.header.map((col) => row[col])
        );
        const csv = toCsv(spec.header, rows);

        logEvent(req, spec.event, { tenantId, rowCount: rows.length });

        void reply.header('Content-Type', 'text/csv; charset=utf-8');
        void reply.header(
          'Content-Disposition',
          `attachment; filename="${spec.filename}-${new Date().toISOString().slice(0, 10)}.csv"`
        );
        return reply.send(csv);
      }, `Failed to export ${kind} CSV`)
    );
  }
}
