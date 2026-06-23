/**
 * Data-retention service — the automated counterpart to the manual
 * POST /customers/:id/purge erasure endpoint.
 *
 * Finds customers who are past a tenant's retention window and dormant (no
 * recent appointments) and anonymizes them IN PLACE — same shape as the manual
 * purge: PII columns → NULL, metadata → {}, phone → an opaque tombstone,
 * is_deleted → true, plus a redact of the audit_log PII snapshots the trigger
 * captured. Row + FKs survive; personal data does not.
 *
 * ⚠️ FLAGGED FOR LEGAL REVIEW — this performs automated, irreversible erasure of
 * customer PII. The worker that drives it (src/workers/retentionWorker.ts) is
 * DISABLED by default and refuses to run without an explicitly configured
 * retention window. Do NOT enable in prod until retention periods are signed off
 * and the broader-PII scope (voice_sessions, transcripts, appointment
 * descriptions) is decided. Same tight scope as the manual endpoint: this
 * erases the canonical customers row + its audit snapshots only.
 */
import type { Pool, PoolClient } from 'pg';

export interface RetentionSweepResult {
  tenantId: string;
  anonymizedCustomerIds: string[];
}

/**
 * Anonymize one customer in place + redact its audit_log PII, on an existing
 * (RLS-scoped) client. Mirrors the manual purge endpoint's SQL exactly; the two
 * should be unified into a single shared statement once both land. `deletedBy`
 * is recorded for the audit trail of who/what triggered the erasure.
 *
 * The two UPDATEs run in a single transaction (BEGIN/COMMIT, ROLLBACK on error):
 * the customers audit trigger writes the pre-purge PII into audit_log.old_data
 * as part of the first UPDATE, so a crash or failure between the two autocommit
 * statements would otherwise leave the customer anonymized while the audit
 * snapshot still held the original PII — defeating the "audit leak closed"
 * guarantee. Atomicity makes the redaction all-or-nothing.
 */
export async function anonymizeCustomerInTx(
  client: PoolClient,
  tenantId: string,
  customerId: string,
  deletedBy: string
): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(
      `UPDATE customers
          SET name = NULL, email = NULL, address = NULL, address_line2 = NULL,
              first_name = NULL, last_name = NULL, city = NULL, state = NULL,
              postal_code = NULL, metadata = '{}'::jsonb,
              phone = 'PURGED-' || customer_id::text,
              is_deleted = true, deleted_at = now(), deleted_by = $3, updated_at = now()
        WHERE customer_id = $1 AND tenant_id = $2`,
      [customerId, tenantId, deletedBy]
    );
    await client.query(
      `UPDATE audit_log
          SET old_data = NULL, new_data = NULL
        WHERE tenant_id = $1 AND table_name = 'customers' AND record_id = $2`,
      [tenantId, customerId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/**
 * Customers eligible for retention-based erasure within one tenant: created
 * before the retention window AND with no appointment inside the window (truly
 * dormant). Conservative on purpose — a single recent appointment keeps the
 * record. Oldest first, capped.
 */
export async function findEligibleCustomerIds(
  client: PoolClient,
  tenantId: string,
  retentionDays: number,
  limit: number
): Promise<string[]> {
  const res = await client.query<{ customer_id: string }>(
    `SELECT c.customer_id
       FROM customers c
      WHERE c.tenant_id = $1
        AND c.is_deleted = false
        AND c.created_at < now() - ($2 * interval '1 day')
        AND NOT EXISTS (
          SELECT 1 FROM appointments a
           WHERE a.customer_id = c.customer_id
             AND a.tenant_id = $1
             AND a.start_time >= now() - ($2 * interval '1 day')
        )
      ORDER BY c.created_at ASC
      LIMIT $3`,
    [tenantId, retentionDays, limit]
  );
  return res.rows.map((r) => r.customer_id);
}

/**
 * Run one retention sweep for a single tenant: find eligible customers, then
 * anonymize each. The caller supplies a `withTenantClient` bound to the pool so
 * every statement runs under the tenant's RLS context.
 */
export async function sweepTenant(
  withTenantClient: <T>(tenantId: string, fn: (client: PoolClient) => Promise<T>) => Promise<T>,
  tenantId: string,
  retentionDays: number,
  batchSize: number
): Promise<RetentionSweepResult> {
  return withTenantClient(tenantId, async (client) => {
    const ids = await findEligibleCustomerIds(client, tenantId, retentionDays, batchSize);
    for (const id of ids) {
      await anonymizeCustomerInTx(client, tenantId, id, 'retention-worker');
    }
    return { tenantId, anonymizedCustomerIds: ids };
  });
}

/** All tenant ids, for the worker to iterate. Pool-level (no tenant context). */
export async function listTenantIds(pool: Pool): Promise<string[]> {
  const res = await pool.query<{ tenant_id: string }>('SELECT tenant_id FROM tenants');
  return res.rows.map((r) => r.tenant_id);
}
