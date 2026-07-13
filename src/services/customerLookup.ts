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

/**
 * Names that are not names. A caller who hasn't said who they are yet gets one of
 * these as a stand-in, and every one of them must be OVERWRITABLE the moment a real
 * name arrives.
 *
 * THE BUG THIS FIXES (a real call, 2026-07-12): the write-guard below already knew
 * 'Caller' was junk — it refused to write it over a real name — but the UPDATE's
 * WHERE clause only overwrote NULL / '' / 'Valued Customer'. It had never been told
 * 'Caller' was a placeholder too. So a customer stored as 'Caller' could NEVER be
 * corrected: the real name arrived, the UPDATE matched zero rows, and the placeholder
 * became permanent.
 *
 * Camille called, gave her name, corrected the agent twice, and is still in the CRM
 * as "Caller". Every future call would have greeted her by it — and now that the
 * preference prefetch loads her record on turn one, it would have done so
 * confidently, forever.
 *
 * ONE list, used by BOTH the write-guard and the overwrite-clause, so they cannot
 * drift apart again. That drift IS the bug.
 */
/**
 * EXPORTED because the comment directly above this line said the drift IS the
 * bug, and then the list stayed private and the drift happened anyway.
 *
 * identify-caller (agentTools/identity.ts) kept its own inline `name =
 * 'Valued Customer'` check that did NOT know about 'Caller' — while
 * agentTools/scheduling.ts writes `args.name || 'Caller'` on every nameless
 * booking. So: caller books before giving a name → stored as 'Caller' → later
 * gives their name → identify_caller's CASE doesn't match 'Caller' → the name is
 * NEVER overwritten, and the session prefetch cheerfully greets them as "Caller"
 * on every future call, forever. That is the exact 2026-07-12 bug, still live on
 * the other write path.
 *
 * One list. Every write path imports it. There is no second copy to drift.
 */
export const PLACEHOLDER_NAMES = ['Valued Customer', 'Caller', 'Unknown'] as const;

function isPlaceholderName(name: string | null | undefined): boolean {
  return (
    !name?.trim() || PLACEHOLDER_NAMES.includes(name.trim() as (typeof PLACEHOLDER_NAMES)[number])
  );
}

export async function getOrCreateCustomerByPhone(
  withTenantClient: WithTenantClient,
  tenantId: string,
  phoneNormalized: string,
  name: string
): Promise<string> {
  return withTenantClient(tenantId, async (client) => {
    const existing = await client.query<{ customer_id: string }>(
      `SELECT customer_id FROM customers
        WHERE tenant_id = $1 AND phone = $2
          AND (is_deleted IS NULL OR is_deleted = false)`,
      [tenantId, phoneNormalized]
    );
    if (existing.rows.length > 0) {
      const customerId = existing.rows[0].customer_id;
      // A real name always beats a placeholder — including one we stored ourselves
      // on an earlier turn of THIS call, which is the common case: the agent books
      // (or tries to) before the caller has said who they are.
      if (!isPlaceholderName(name)) {
        await client.query(
          `UPDATE customers SET name = $1
           WHERE customer_id = $2
             AND (name IS NULL OR name = '' OR name = ANY($3::text[]))`,
          [name, customerId, PLACEHOLDER_NAMES]
        );
      }
      return customerId;
    }
    const inserted = await client.query<{ customer_id: string }>(
      `INSERT INTO customers (tenant_id, phone, name)
         VALUES ($1, $2, $3) RETURNING customer_id`,
      [tenantId, phoneNormalized, name]
    );
    return inserted.rows[0].customer_id;
  });
}
