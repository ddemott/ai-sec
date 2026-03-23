-- Automated phone provisioning columns for Vapi integration
-- Tracks Vapi assistant and phone number IDs, plus provisioning lifecycle status

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS vapi_assistant_id TEXT,
  ADD COLUMN IF NOT EXISTS vapi_phone_number_id TEXT,
  ADD COLUMN IF NOT EXISTS phone_status TEXT NOT NULL DEFAULT 'inactive';

-- phone_status values: 'inactive', 'provisioning', 'active', 'failed', 'deprovisioned'

CREATE INDEX IF NOT EXISTS idx_tenants_vapi_assistant
  ON tenants (vapi_assistant_id) WHERE vapi_assistant_id IS NOT NULL;

COMMENT ON COLUMN tenants.vapi_assistant_id IS 'Vapi assistant UUID returned from POST /assistant';
COMMENT ON COLUMN tenants.vapi_phone_number_id IS 'Vapi phone number ID returned from POST /phone-number';
COMMENT ON COLUMN tenants.phone_status IS 'Phone provisioning lifecycle: inactive, provisioning, active, failed, deprovisioned';
