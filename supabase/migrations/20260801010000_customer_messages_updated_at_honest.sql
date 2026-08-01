-- Make customer_messages.updated_at tell the truth.
--
-- Review catch on PR #312, and a fair one. The previous migration added the
-- column as `NOT NULL DEFAULT now()`, which stamps EVERY EXISTING ROW with the
-- migration's own timestamp — so untouched historical messages read as
-- "revised", which is precisely the opposite of what the column was added for.
-- A field whose whole job is "this row changed" must not claim it about rows
-- that never did.
--
-- Two fixes:
--
--   1. BACKFILL updated_at = created_at. Safe to do unconditionally: the column
--      is hours old, the code that writes it (take-message's upsert) is not
--      deployed yet, so no row has been legitimately updated through it. After
--      this, updated_at > created_at means exactly one thing — someone changed
--      the row.
--
--   2. TRIGGER, not a hand-written bump. The upsert sets updated_at itself, but
--      /voice/messages/:id (the dashboard marking a message read/handled) does
--      not — so the column would have been reliable for corrections and quietly
--      wrong for everything else. fn_set_updated_at is the house pattern
--      (appointments, customers); using it means EVERY update maintains the
--      column, including ones nobody has written yet.
UPDATE customer_messages
   SET updated_at = created_at
 WHERE updated_at <> created_at;

DROP TRIGGER IF EXISTS trg_customer_messages_updated_at ON customer_messages;
CREATE TRIGGER trg_customer_messages_updated_at
  BEFORE UPDATE ON customer_messages
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
