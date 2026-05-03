/**
 * Fetches the tenant's display name + IANA timezone from the backend so
 * the system prompt and greeting can use real values instead of generic
 * defaults. Called once per call, on connect.
 *
 * If the backend is unreachable, the tenant_id is unknown, or the response
 * is malformed, returns a generic-but-safe fallback rather than letting
 * the call fail. Going silent on a caller is worse than greeting them
 * with "this business" in the default zone.
 */
import type { ToolsClient } from './toolsClient.js';

export interface TenantDisplayConfig {
  name: string;
  timezone: string;
}

export const TENANT_FALLBACK: TenantDisplayConfig = {
  name: 'this business',
  timezone: 'America/Chicago',
};

export async function fetchTenantConfig(
  client: ToolsClient,
  tenantId: string,
): Promise<TenantDisplayConfig> {
  const res = await client.call<TenantDisplayConfig>('/agent-tools/tenant-config', {
    tenant_id: tenantId,
  });
  if (res.ok && res.result?.name && res.result?.timezone) {
    return { name: res.result.name, timezone: res.result.timezone };
  }
  return TENANT_FALLBACK;
}
