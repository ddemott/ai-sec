# Persona name as a tenant profile field — design

**Date:** 2026-06-28
**Status:** Approved (design); implementation pending
**Author:** Dale DeMott + Claude

## Problem

The voice AI persona's name (currently "Chris" for Thinking Hammer) is baked as
free-text inside `tenants.system_prompt` and `tenants.first_message`. There is no
first-class field on the tenant (client) profile holding the name. Renaming the AI
means hand-editing prompt text and risks drift between the system prompt and the
greeting. The owner cannot rename their assistant from the dashboard.

## Goal

Make the persona name a first-class, owner-editable field on the tenant profile.
One edit renames the AI everywhere it speaks (system prompt identity + greeting),
with zero code change and zero risk to tenants that don't use the feature.

## Approach (approved)

**Column + runtime substitution.** Add a `tenants.persona_name` column. Stored
prompt text contains a `__PERSONA_NAME__` token; the agent substitutes the token
with the column value at call time. NULL name or missing token = no-op (literal
text passes through untouched).

### Safe defaults (baked in)

1. **NULL / no-token = no-op fallback.** If `persona_name` is NULL, or the prompt
   contains no `__PERSONA_NAME__` token, substitution returns the text unchanged.
   Existing tenants (e.g. Bella's Hair Studio) are unaffected — forward-compatible
   per the "merge before migrate" rule (`planning/RESOLVED.md`). The column can ship before
   any prompt uses the token.
2. **Backfill only Thinking Hammer.** Migration sets `persona_name = 'Chris'` for
   tenant `d5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0`; all other tenants stay NULL.

### YAGNI cut

Validation = trim + length 1–80 only. No uniqueness, no profanity filter — it is a
free display name.

## Components

### 1. Data model

- **Migration** `supabase/migrations/<ts>_tenant_persona_name.sql`:
  `ALTER TABLE tenants ADD COLUMN persona_name text;` then
  `UPDATE tenants SET persona_name = 'Chris' WHERE tenant_id = 'd5e3c6a1-7b9f-4e2a-bf30-8c11a5d8e9f0';`
- Regenerate `supabase/baseline.sql` (`npm run db:baseline`) so the schema-alignment
  CI guard passes.
- **Seed change** (`supabase/seed_thinkinghammer_aiassistant.sql`): stop baking the
  name at the `replace(prompt_text, '__PERSONA_NAME__', persona_name)` step — store
  the prompt **with the token intact** and set the `tenants.persona_name` column =
  `'Chris'` instead. The stored `system_prompt` and `first_message` must both retain
  `__PERSONA_NAME__` so runtime substitution has something to replace. Confirm
  `first_message` in the seed uses the token (add it if it currently bakes the name).

### 2. Substitution helper (core unit)

New pure function in the agent package:

```ts
// agent/src/personaName.ts
export function substitutePersonaName(
  text: string | null,
  name: string | null,
): string | null {
  if (text == null || name == null) return text;
  return text.split('__PERSONA_NAME__').join(name);
}
```

- One responsibility: replace the token. No I/O, no config knowledge.
- Null text → null. Null name → text unchanged. No token → text unchanged.
- Applied to **both** `systemPrompt` and `firstMessage` inside
  `agent/src/tenantConfig.ts::fetchTenantConfig`, immediately after the fields are
  read from the backend, so every downstream consumer (`prompt.ts`, the greeting
  path in `index.ts`) receives already-substituted text. Single code path — no risk
  of substituting one field and missing the other.

### 3. Backend

- **`src/routes/agentTools.ts`** — `/agent-tools/tenant-config` handler:
  - Add `persona_name` to the `SELECT` (currently line ~484), the row type
    (~471), and the JSON response (~513). Mirrors `tts_voice`.
- **`agent/src/tenantConfig.ts`**:
  - Add `personaName: string | null` to the `TenantConfig` type and the default
    config; map it from `res.result.persona_name ?? null`.
- **`src/routes/tenants.ts`**:
  - Add `persona_name: z.string().trim().min(1).max(80).optional().nullable()` to
    `UpdateConfigSchema` (and `UpdateAttributesSchema` if attributes-update should
    accept it too — match `first_message` placement).
  - Thread it through the `UPDATE` statement, the `FOR UPDATE` prior-read +
    COALESCE-style merge (`body.persona_name !== undefined ? body.persona_name :
    prior?.persona_name ?? null`), and the two return `SELECT`s (lines ~163, ~222).
    Mirrors `tts_voice` exactly.

### 4. Dashboard

- **`dashboard/components/AIConfigView.tsx`**: add an "Assistant name" `<Input>`
  above the first-message field. Load via `Api.tenants.getConfig` (add field to the
  config state), save via `Api.tenants.updateConfig` (include `persona_name` in the
  payload at line ~83). Helper text: "The name your AI assistant gives callers."
- **`dashboard/lib/types.ts`** + **`dashboard/lib/api.ts`**: add `persona_name:
  string | null` to the tenant-config type used by get/update.

## Data flow

```
Dashboard AI Persona page
   │  PATCH (Api.tenants.updateConfig { persona_name })
   ▼
tenants.ts  ──UPDATE──►  tenants.persona_name = 'Chris'
                          system_prompt: 'You are __PERSONA_NAME__, ...'
                          first_message: 'Hi, I'm __PERSONA_NAME__ ...'
   ▲
   │  POST /agent-tools/tenant-config
agent tenantConfig.fetchTenantConfig
   │  substitutePersonaName(systemPrompt, personaName)
   │  substitutePersonaName(firstMessage, personaName)
   ▼
'You are Chris, ...'  /  'Hi, I'm Chris ...'  →  live call
```

## Error handling

- Empty/whitespace or >80-char name → 400 from the Zod schema (trim + min/max).
- NULL persona_name → substitution no-op → literal prompt text used (safe).
- Backend read failure in `fetchTenantConfig` already falls back to default config
  (existing behavior); `personaName` defaults to null → no-op.

## Testing

- **Unit (`agent/src/personaName.test.ts`)**: null text, null name, no token, happy
  single + multiple token swap.
- **Agent (`agent/src/tenantConfig.test.ts`)**: `fetchTenantConfig` substitutes the
  token in BOTH `systemPrompt` and `firstMessage`; no-op when name null.
- **Backend (`src/routes/tenants` tests)**: PATCH persists `persona_name`;
  validation rejects empty + >80; tenant-config endpoint returns it.
- **Dashboard (`AIConfigView.test.tsx`)**: renders the input, loads existing value,
  includes `persona_name` in the save payload.
- **E2E**: out of scope for v1 (unit + integration cover the path).

## Scope boundaries

- **In:** column + migration + backfill, backend read/write, agent substitution,
  dashboard field, tests above.
- **Out (v1):** E2E test; name uniqueness/profanity validation; a separate
  `persona_name` template in `business_templates` (tenant-level only for now);
  retroactively tokenizing other tenants' prompts (only Thinking Hammer + the seed).

## Sequencing

1. **Split the Beth→Chris rename into its own PR first** (already staged in the
   working tree) so this feature's diff stays clean.
2. Then this feature on branch `feat/persona-name-tenant-field`.
