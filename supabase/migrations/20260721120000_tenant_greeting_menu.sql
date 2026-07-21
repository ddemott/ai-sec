-- Tenant greeting menu — the "what I can help with" line spoken at the top of
-- every call, between the AI disclosure and "How can I help you today?".
--
-- Dale (2026-07-21): the opening should list the business's general CORE
-- offerings ("Job, Computer Repair, Message, or purchase/setup of this service
-- for your own AI secretary") so a caller knows the lanes before they speak.
-- Per-tenant DATA, not platform code — the greeting must never hardcode one
-- business's offerings into every tenant's mouth (the "passed along to Dale"
-- lesson, greeting edition).
--
-- NULL/blank = no menu line; the greeting composes exactly as before.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS greeting_menu TEXT;

COMMENT ON COLUMN tenants.greeting_menu IS
  'Optional spoken services-menu line for the call greeting (between disclosure and closer). NULL/blank = omitted.';
