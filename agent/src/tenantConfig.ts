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
  /**
   * Whether the owner turned on customer-preference capture. When true the
   * system prompt gains a "Customer preferences" section and the agent is
   * told to call save_customer_preference. Default false — preference capture
   * is opt-in (writes durable CRM data + steers upsells).
   */
  savePreferencesEnabled: boolean;
  /**
   * Owner-authored guidance on what preferences to save, why, when, and how to
   * use them. NULL means "use the prompt's built-in default guidance" so the
   * toggle works before the owner writes anything.
   */
  preferencesInstructions: string | null;
}

export const TENANT_FALLBACK: TenantDisplayConfig = {
  name: 'this business',
  timezone: 'America/Chicago',
  systemPrompt: null,
  savePreferencesEnabled: false,
  preferencesInstructions: null,
};

export async function fetchTenantConfig(
  client: ToolsClient,
  tenantId: string
): Promise<TenantDisplayConfig> {
  // Backend returns snake_case — convert to TS-idiomatic camelCase at the
  // boundary.
  const res = await client.call<{
    name: string;
    timezone: string;
    system_prompt: string | null;
    save_preferences_enabled?: boolean;
    preferences_instructions?: string | null;
  }>('/agent-tools/tenant-config', { tenant_id: tenantId });
  if (res.ok && res.result?.name && res.result?.timezone) {
    return {
      name: res.result.name,
      timezone: res.result.timezone,
      systemPrompt: res.result.system_prompt ?? null,
      savePreferencesEnabled: res.result.save_preferences_enabled ?? false,
      preferencesInstructions: res.result.preferences_instructions ?? null,
    };
  }
  return TENANT_FALLBACK;
}
