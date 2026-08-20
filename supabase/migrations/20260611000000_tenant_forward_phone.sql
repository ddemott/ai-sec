-- Per-tenant call-forwarding / live-transfer destination.
--
-- Background: when a caller asks for a human (or hits the "personal call"
-- branch of the receptionist persona), the agent can cold-transfer the live
-- PSTN call off LiveKit via SIP REFER back through the inbound trunk
-- (SipClient.transferSipParticipant → tel:<forward_phone>). This column holds
-- the number to ring.
--
--   forward_phone — E.164 PSTN number the agent transfers live calls to
--                   (e.g. the owner's cell). NULL = no transfer destination
--                   configured; the transfer_call tool stays inert and the
--                   agent takes a message instead. Owner-editable.
--
-- Forward-only safe: ADD COLUMN IF NOT EXISTS, nullable, no backfill. NULL is
-- the safe default (transfer disabled), so existing tenants are unaffected.

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS forward_phone TEXT;

COMMENT ON COLUMN tenants.forward_phone IS 'E.164 PSTN number the agent cold-transfers live calls to (owner cell). NULL = transfer disabled, agent takes a message.';

