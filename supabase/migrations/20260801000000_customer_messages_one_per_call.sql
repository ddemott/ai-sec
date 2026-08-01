-- ONE message row per call — so a correction can REACH the row that already exists.
--
-- 2026-07-27, SCL_ReG7kLRiY94c (CALL_IMPROVEMENTS.md #2). The caller's name was
-- heard as "Jamil". The message was saved. Thirty seconds later she corrected
-- it — "You got my name wrong… Camille, C-A-M-I-L-L-E" — the agent said thank
-- you, the tracker updated, and the ROW DID NOT CHANGE. It still says Jamil in
-- production today. The customer record separately reads "Camille DeMott", so
-- the owner has one person under two names and a message he cannot match to a
-- caller.
--
-- take-message was INSERT-only: every call to it makes a new row, so there was
-- nothing to update and no way to know which row to update. This index makes
-- (tenant_id, call_id) the identity of a message, which buys two things at once:
--
--   1. CORRECTIONS LAND. ON CONFLICT DO UPDATE rewrites the row this call
--      already wrote, instead of appending a second, contradictory one.
--   2. RETRIES STOP DUPLICATING. An action-node tool is retried until it
--      returns its success id, so concurrent retries of one call must converge
--      on ONE row — exactly the failure that wrote four identical job
--      inquiries behind a hung SMTP send (migration 20260717230000, whose
--      shape this deliberately mirrors).
--
-- Partial: call_id is NULL for dashboard-created messages, and those are not
-- "one per call" in any sense.
--
-- NB dedupe first — an index cannot be created over existing duplicates. Keep
-- the EARLIEST row per (tenant, call): it is the one whose id was handed back
-- to the agent, and the one any appointment/summary already refers to.
WITH ranked AS (
  SELECT message_id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, call_id ORDER BY created_at ASC, message_id ASC
         ) AS rn
    FROM customer_messages
   WHERE call_id IS NOT NULL
)
DELETE FROM customer_messages cm
 USING ranked r
 WHERE cm.message_id = r.message_id
   AND r.rn > 1;

-- A revised message should SAY it was revised: without this, an owner looking
-- at a corrected row has no way to tell it changed, and a postmortem cannot
-- distinguish "written once" from "written, then fixed mid-call".
ALTER TABLE customer_messages
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS customer_messages_one_per_call
  ON customer_messages (tenant_id, call_id)
  WHERE call_id IS NOT NULL;

COMMENT ON INDEX customer_messages_one_per_call IS
  'One message per call: makes take-message idempotent under retry AND lets a mid-call correction update the row instead of appending a contradictory second one.';
