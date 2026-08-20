-- Drop three columns nothing reads, two of which state things that are not true.
--
-- `business_templates.voice_provider` / `voice_name`
--   Zero TypeScript readers. Backfilled with `cartesia` / `elevenlabs` and voice
--   names `Josh`, `Rachel`, `Default Male` — an ElevenLabs vocabulary for a
--   product whose TTS has only ever been OpenAI (to 2026-07-14) and then
--   Deepgram Aura. These are not stale values, they are FALSE ones: any future
--   reader would be told the platform uses providers it has never integrated.
--   The live per-tenant voice lives in `tenants.tts_voice`, which is an OpenAI
--   voice id, set from the dashboard's AI Persona page. Until PR #356 these two
--   columns were also shipped to every authenticated dashboard user by
--   `GET /templates/full`'s `SELECT *`.
--
-- `tenant_integration_settings.webhook_secret`
--   Jobber-era leftover, zero readers. The table holds ZERO ROWS in production,
--   so this drops nothing at all.
--
-- VERIFIED AGAINST PROD BEFORE WRITING THIS:
--   business_templates            = 30 rows, voice_provider ∈ {cartesia, elevenlabs, NULL}
--   tenant_integration_settings   = 0 rows,  webhook_secret non-null = 0
--
-- A column with no reader cannot be wrong in a way anyone notices, which is
-- exactly why it survives: nothing fails, so nothing prompts anyone to look. The
-- cost lands later, on whoever believes it.

ALTER TABLE public.business_templates DROP COLUMN IF EXISTS voice_provider;
ALTER TABLE public.business_templates DROP COLUMN IF EXISTS voice_name;
ALTER TABLE public.tenant_integration_settings DROP COLUMN IF EXISTS webhook_secret;
