-- Tenant-safe checklist overrides (Step 9).
-- Only disable lists are stored; the derive function rejects identity
-- removal and blocks that are not in the selected preset.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS checklist_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN tenants.checklist_overrides IS
  'Safe checklist tweaks. Shape: { disabled_conversation_blocks?: string[], booking_mode?: offer_once|prefer|never, message_mode?: always|fallback_only, optional_node_ids?: string[] }. Invalid entries are ignored on read and rejected on write.';
