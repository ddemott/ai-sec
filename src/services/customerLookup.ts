import type { PoolClient } from 'pg';

/**
 * Get-or-create a customer by phone, in its own transaction.
 *
 * Why this lives in its own withTenantClient call (and not piggy-backed on a
 * booking transaction): when a voice agent successfully captures a new
 * caller's phone but the booking RPC then fails (timeslot taken, no skilled
 * employee, etc.), we want the customer record to persist so the next attempt
 * doesn't have to re-collect the same identity. Today that persistence is
 * a side-effect of Postgres auto-commit — but if the booking pathway is ever
 * wrapped in an explicit BEGIN/COMMIT (audit trigger, savepoint, etc.) the
 * customer would silently start rolling back on every booking failure. By
 * acquiring our own pool client here, the customer write is structurally a
 * separate transaction regardless of how the caller is wrapped.
 *
 * Idempotent on the (tenant_id, phone) pair: looks up first, inserts only
 * when no live row exists. Soft-deleted customers are treated as missing so
 * a phone that was deleted gets a fresh row instead of resurrecting old data.
 */
export type WithTenantClient = <T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
) => Promise<T>;

export async function getOrCreateCustomerByPhone(
  withTenantClient: WithTenantClient,
  tenantId: string,
  phoneNormalized: string,
  name: string
): Promise<string> {
  return withTenantClient(tenantId, async (client) => {
    const existing = await client.query<{ id: string }>(
      `SELECT customer_id AS id FROM customers
        WHERE tenant_id = $1 AND phone = $2
          AND (is_deleted IS NULL OR is_deleted = false)`,
      [tenantId, phoneNormalized]
    );
    if (existing.rows.length > 0) {
      return existing.rows[0].id;
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO customers (tenant_id, phone, name)
         VALUES ($1, $2, $3) RETURNING customer_id AS id`,
      [tenantId, phoneNormalized, name]
    );
    return inserted.rows[0].id;
  });
}
