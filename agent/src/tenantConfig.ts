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
  /**
   * Owner-authored role/identity prompt with optional Handlebars-style
   * placeholders (`{{business_name}}`, `{{current_date}}`,
   * `{{caller_phone}}`). NULL means "no override — fall back to the
   * hardcoded Clara identity in buildSystemPrompt". 2026-05-18: added
   * so the dashboard's AI Persona text actually reaches the LLM.
   */
  systemPrompt: string | null;
}

export const TENANT_FALLBACK: TenantDisplayConfig = {
  name: 'this business',
  timezone: 'America/Chicago',
  systemPrompt: null,
};

export async function fetchTenantConfig(
  client: ToolsClient,
  tenantId: string
): Promise<TenantDisplayConfig> {
  // Backend returns { name, timezone, system_prompt } — convert snake_case
  // to the TS-idiomatic camelCase at the boundary.
  const res = await client.call<{ name: string; timezone: string; system_prompt: string | null }>(
    '/agent-tools/tenant-config',
    { tenant_id: tenantId }
  );
  if (res.ok && res.result?.name && res.result?.timezone) {
    return {
      name: res.result.name,
      timezone: res.result.timezone,
      systemPrompt: res.result.system_prompt ?? null,
    };
  }
  return TENANT_FALLBACK;
}
