-- Owner-configurable CLOSING QUESTION for the call greeting.
--
-- Dale (2026-07-23): "How can I help you today?" is too generic — like just
-- saying hello. A lost caller freezes and hangs up feeling awkward rather than
-- admitting they don't know what the business does. Replacing the closer with a
-- GUIDING question that names the services ("What do you need help with:
-- hiring Dale, a computer fix, or maybe just leaving a message?") hands the
-- caller concrete choices to pick from — they never have to confess confusion.
--
-- Per-tenant DATA (each business's services differ), never platform code.
-- NULL/blank = the historical default "How can I help you today?" — every
-- existing tenant is unaffected. When a transfer number is configured, the
-- representative opt-out is prepended to whichever closer is in effect
-- (agent/src/greeting.ts buildGreeting).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS greeting_closer TEXT;

COMMENT ON COLUMN tenants.greeting_closer IS
  'Optional spoken closing question for the call greeting, replacing the default "How can I help you today?". NULL/blank = default.';
