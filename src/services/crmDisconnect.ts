/**
 * Shared disconnect helper for CRM provider routes.
 *
 * jobber, hubspot, square, and servicetitan each used to maintain a
 * near-identical 16-line POST /<provider>/settings/disconnect handler
 * that ran the same two DELETE queries against tenant_integration_settings
 * and entity_sync_map, scoped to (tenant_id, provider). The provider name
 * was the only meaningful variable.
 *
 * This helper centralizes the disconnect SQL so the route bodies stay
 * thin and the success-envelope contract ({success: true}) lives in one
 * place. Mirrors the shape of crmSyncStatus.ts.
 */

import type { PoolClient } from 'pg';
import type { CrmProvider } from './crmSyncStatus';

export type { CrmProvider };

/**
 * Disconnect a tenant from a CRM integration. Runs as part of the
 * caller's tenant-scoped transaction (RLS context is already set on
 * the client by `withTenantClient`).
 *
 * Two effects, both idempotent:
 *   1. DELETE the tenant's entry in tenant_integration_settings (drops
 *      stored OAuth tokens + last_sync_at + provider config).
 *   2. DELETE every entity_sync_map row for this (tenant, provider) —
 *      orphaned mappings to the now-disconnected remote system.
 *
 * Caller is responsible for the audit log event (each route emits its
 * own `<provider>_disconnected` event so the existing logEvent contract
 * stays per-provider). Caller also sends the success envelope.
 */
export async function disconnectCrmIntegration(
  client: PoolClient,
  tenantId: string,
  provider: CrmProvider,
): Promise<void> {
  await client.query(
    `DELETE FROM tenant_integration_settings WHERE tenant_id = $1 AND provider = $2`,
    [tenantId, provider],
  );
  await client.query(
    `DELETE FROM entity_sync_map WHERE tenant_id = $1 AND provider = $2`,
    [tenantId, provider],
  );
}
