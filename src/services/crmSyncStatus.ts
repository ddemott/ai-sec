/**
 * Shared sync-status reader for CRM provider routes.
 *
 * The CRM provider routes (Square today; Jobber/HubSpot/ServiceTitan removed 2026-06-12) each maintained a
 * near-identical 25-line GET /<provider>/sync/status handler that did
 * the same SELECT last_sync_at + entity_sync_map COUNT, then folded the
 * counts into pending/error totals split by entity type. Different
 * provider names was the only meaningful variable.
 *
 * This helper centralizes the SQL and the shape so the route bodies
 * just resolve `provider` and call us. Changes to the response contract
 * (e.g., adding a new entity_type, adjusting status names) now happen
 * in one place instead of four.
 */

import type { PoolClient } from 'pg';

/**
 * The four providers wired through tenant_integration_settings +
 * entity_sync_map. Calendar (Google/Outlook) lives in a different
 * table and has its own status surface.
 */
export type CrmProvider = 'square';

export interface CrmSyncStatus {
  last_sync_at: string | null;
  pending_count: number;
  error_count: number;
  total_mapped: {
    customers: number;
    appointments: number;
  };
}

interface CountRow {
  entity_type: string;
  sync_status: string;
  count: number;
}

/**
 * Read the current sync state for a tenant + CRM provider.
 *
 * Runs as part of the caller's tenant-scoped transaction (RLS context
 * is already set on the client by `withTenantClient`). Returns null
 * for `last_sync_at` when no settings row exists — the route layer
 * can decide how to render that.
 */
export async function getCrmSyncStatus(
  client: PoolClient,
  tenantId: string,
  provider: CrmProvider
): Promise<CrmSyncStatus> {
  const settingsRes = await client.query<{ last_sync_at: string | null }>(
    `SELECT last_sync_at FROM tenant_integration_settings
     WHERE tenant_id = $1 AND provider = $2`,
    [tenantId, provider]
  );

  const countsRes = await client.query<CountRow>(
    `SELECT entity_type, sync_status, COUNT(*)::int AS count
     FROM entity_sync_map
     WHERE tenant_id = $1 AND provider = $2
     GROUP BY entity_type, sync_status`,
    [tenantId, provider]
  );

  const counts = countsRes.rows;
  const sumWhere = (predicate: (row: CountRow) => boolean): number =>
    counts.filter(predicate).reduce((sum, row) => sum + row.count, 0);

  return {
    last_sync_at: settingsRes.rows[0]?.last_sync_at ?? null,
    pending_count: sumWhere((r) => r.sync_status === 'pending'),
    error_count: sumWhere((r) => r.sync_status === 'error'),
    total_mapped: {
      customers: sumWhere((r) => r.entity_type === 'customer'),
      appointments: sumWhere((r) => r.entity_type === 'appointment'),
    },
  };
}
