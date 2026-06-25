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
   * Owner-editable greeting (dashboard "First Message"). The agent speaks this
   * as the literal opening line; NULL falls back to the hardcoded
   * "Thanks for calling <name>…" so a tenant that never set one is unaffected.
   */
  firstMessage: string | null;
  /**
   * Whether customer-preference capture is enabled. Default true — the agent
   * saves durable facts about returning callers by default. Owners can opt out
   * via the dashboard AI Persona page (sets column to false).
   */
  savePreferencesEnabled: boolean;
  /**
   * Owner-authored guidance on what preferences to save, why, when, and how to
   * use them. NULL means "use the prompt's built-in default guidance" so the
   * toggle works before the owner writes anything.
   */
  preferencesInstructions: string | null;
  /**
   * Per-tenant OpenAI TTS settings. ttsVoice is an OpenAI voice id
   * (shimmer/nova/alloy/echo/onyx/fable); NULL = platform default (shimmer).
   * ttsSpeed is the OpenAI speech rate. (The old Grok-only soft/cheerful prosody
   * tags were dropped 2026-06-25 in the full OpenAI conversion.)
   */
  ttsVoice: string | null;
  ttsSpeed: number | null;
  // Persona-tone toggles below feed the SYSTEM PROMPT (prompt.ts), not TTS.
  ttsFormal: boolean | null;
  ttsWarm: boolean | null;
  ttsConcise: boolean | null;
  /**
   * E.164 PSTN number the agent cold-transfers a live call to (owner cell),
   * via SIP REFER through the inbound trunk. NULL means no forwarding is
   * configured — the transfer_call tool reports it can't transfer and the
   * agent takes a message instead. 2026-06-11.
   */
  forwardPhone: string | null;
}

export const TENANT_FALLBACK: TenantDisplayConfig = {
  name: 'this business',
  timezone: 'America/Chicago',
  systemPrompt: null,
  firstMessage: null,
  savePreferencesEnabled: true,
  preferencesInstructions: null,
  ttsVoice: null,
  ttsSpeed: null,
  ttsFormal: null,
  ttsWarm: null,
  ttsConcise: null,
  forwardPhone: null,
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
    first_message?: string | null;
    save_preferences_enabled?: boolean;
    preferences_instructions?: string | null;
    tts_voice?: string | null;
    tts_speed?: number | null;
    tts_formal?: boolean | null;
    tts_warm?: boolean | null;
    tts_concise?: boolean | null;
    forward_phone?: string | null;
  }>('/agent-tools/tenant-config', { tenant_id: tenantId });
  if (res.ok && res.result?.name && res.result?.timezone) {
    return {
      name: res.result.name,
      timezone: res.result.timezone,
      systemPrompt: res.result.system_prompt ?? null,
      firstMessage: res.result.first_message ?? null,
      savePreferencesEnabled: res.result.save_preferences_enabled ?? true,
      preferencesInstructions: res.result.preferences_instructions ?? null,
      ttsVoice: res.result.tts_voice ?? null,
      ttsSpeed: res.result.tts_speed ?? null,
      ttsFormal: res.result.tts_formal ?? null,
      ttsWarm: res.result.tts_warm ?? null,
      ttsConcise: res.result.tts_concise ?? null,
      forwardPhone: res.result.forward_phone ?? null,
    };
  }
  return TENANT_FALLBACK;
}
