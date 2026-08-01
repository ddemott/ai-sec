-- is_urgent: the caller said this could not wait, and the owner should see it first.
--
-- 2026-07-27, SCL_dpp8qN8ogCtF (CALL_IMPROVEMENTS.md #7). The caller said "I
-- want to talk with him URGENTLY" — the strongest signal a caller can send —
-- and got a list of appointment slots. There is no human-handoff path on a live
-- call (transfer_call is not in the question-tree toolset), so a slot menu was
-- literally all the agent had to offer, and the caller hung up mid-sentence.
--
-- This does not manufacture a transfer that does not exist. It does the honest
-- thing available: take the message, MARK it urgent, and let the owner's inbox
-- sort on it — so "urgently" reaches a human faster than the next time he
-- happens to check. A real live-transfer path stays a separate piece of work,
-- because it needs verification on an actual call, not a column.
ALTER TABLE customer_messages
  ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN NOT NULL DEFAULT false;

-- Partial: the index exists to answer "what is urgent and unhandled", which is
-- a small slice of a table that will mostly be neither.
CREATE INDEX IF NOT EXISTS idx_customer_messages_urgent
  ON customer_messages (tenant_id, created_at DESC)
  WHERE is_urgent = true AND status = 'new';

COMMENT ON COLUMN customer_messages.is_urgent IS
  'The caller said it could not wait. Set only from the caller''s own words — never inferred from topic.';
