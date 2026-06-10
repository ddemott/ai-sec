-- Per-tenant xAI Grok TTS voice + delivery settings.
--
-- Background: the legacy `tenants.voice_id` column holds Vapi/ElevenLabs voice
-- IDs (set by business_templates triggers) and is NOT read by the current
-- LiveKit + xAI Grok agent — the agent used a single global XAI_TTS_VOICE env.
-- The dashboard's "Voice Identity" picker wrote voice_id (ElevenLabs names),
-- which the Grok agent ignored entirely. Feeding those ElevenLabs IDs to Grok
-- would fail, so we add CLEAN, Grok-specific columns rather than overload
-- voice_id.
--
--   tts_voice  — Grok voice_id: one of 'eve','ara','rex','sal','leo', OR a
--                custom cloned voice_id from the xAI console. NULL = use the
--                agent's XAI_TTS_VOICE env default (so existing tenants are
--                unaffected until an owner picks a voice).
--   tts_speed  — speech pace multiplier (0.7–1.5). NULL = XAI_TTS_SPEED default.
--   tts_soft   — wrap utterances in xAI's <soft> prosody tag. NULL = XAI_TTS_SOFT
--                default.
--
-- Forward-only safe: ADD COLUMN IF NOT EXISTS, all nullable, no backfill needed
-- (NULL means "use the agent default"). Zero downtime, zero data loss.

BEGIN;

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS tts_voice TEXT,
    ADD COLUMN IF NOT EXISTS tts_speed REAL,
    ADD COLUMN IF NOT EXISTS tts_soft  BOOLEAN;

COMMENT ON COLUMN tenants.tts_voice IS 'xAI Grok TTS voice_id (eve/ara/rex/sal/leo or a custom clone id). NULL = agent XAI_TTS_VOICE default.';
COMMENT ON COLUMN tenants.tts_speed IS 'Grok TTS speech pace multiplier 0.7–1.5. NULL = agent XAI_TTS_SPEED default.';
COMMENT ON COLUMN tenants.tts_soft  IS 'Wrap TTS text in xAI <soft> prosody tag for a softer delivery. NULL = agent XAI_TTS_SOFT default.';

COMMIT;
