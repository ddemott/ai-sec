-- Add per-tenant customer-preference capture config to tenants.
--
-- Feature: owners can turn on "remember what customers like" and author a
-- plain-language instruction block telling the AI voice WHAT preferences to
-- save, WHY, WHEN, and HOW to use them. The instruction text is injected into
-- the agent's system prompt (agent/src/prompt.ts) when the toggle is on, and
-- the agent persists what it learns via /agent-tools/save-customer-preference
-- into customers.metadata.preferences — the same JSON surface that
-- get_customer_context_for_call already reads back on the next call
-- (migration 20260512000015, "preferences" key). This closes the write half
-- of an otherwise read-only round-trip.
--
-- Two columns:
--   save_preferences_enabled  — gate. Default FALSE: preference capture is a
--     deliberate opt-in (it writes durable CRM data + steers upsell behavior),
--     so an existing tenant who never configured it stays off. This is the
--     opposite default from sms/email_enabled (those default TRUE) on purpose
--     — silence is the safe state for "should the AI remember things about my
--     customers and pitch them," noisy is the safe state for "send the
--     reminders I asked for."
--   preferences_instructions — owner-authored guidance, free text. NULL means
--     "use the agent's built-in default preference guidance" so the toggle can
--     be flipped on without forcing the owner to write a block first.
--
-- Forward-only safe: ADD COLUMN IF NOT EXISTS with a constant DEFAULT
-- backfills every existing row in one statement. Zero downtime, zero data loss.

BEGIN;

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS save_preferences_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS preferences_instructions TEXT;

COMMENT ON COLUMN tenants.save_preferences_enabled IS 'Opt-in gate for AI customer-preference capture. Default FALSE — owner turns it on in the Phone Assistant config.';
COMMENT ON COLUMN tenants.preferences_instructions IS 'Owner-authored guidance injected into the AI system prompt: what customer preferences to save, why, when, and how to use them. NULL = use the agent built-in default guidance.';

COMMIT;
