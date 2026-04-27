-- Convert phone provisioning from Vapi to Telnyx + LiveKit.
-- Vapi is fully retired; tenant phone numbers are now allocated directly
-- through the Telnyx Numbers API and routed to LiveKit via a SIP Connection.
-- The "assistant" concept is gone — one LiveKit agent worker serves all
-- tenants and reads tenant_id from SIP dispatch metadata.

DROP INDEX IF EXISTS idx_tenants_vapi_assistant;

ALTER TABLE tenants
  DROP COLUMN IF EXISTS vapi_assistant_id,
  DROP COLUMN IF EXISTS vapi_phone_number_id;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS telnyx_phone_number_id TEXT;

CREATE INDEX IF NOT EXISTS idx_tenants_telnyx_phone_number
  ON tenants (telnyx_phone_number_id) WHERE telnyx_phone_number_id IS NOT NULL;

COMMENT ON COLUMN tenants.telnyx_phone_number_id IS 'Telnyx phone number ID (UUID-style) returned from POST /v2/number_orders; used to release the number on deactivation';
COMMENT ON COLUMN tenants.phone_status IS 'Phone provisioning lifecycle: inactive, provisioning, active, failed, deprovisioned';
