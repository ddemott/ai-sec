-- Add Square and ServiceTitan as supported CRM providers

ALTER TABLE tenant_integration_settings DROP CONSTRAINT IF EXISTS tenant_integration_settings_provider_check;
ALTER TABLE tenant_integration_settings ADD CONSTRAINT tenant_integration_settings_provider_check
  CHECK (provider IN ('jobber', 'hubspot', 'square', 'servicetitan'));

ALTER TABLE entity_sync_map DROP CONSTRAINT IF EXISTS entity_sync_map_provider_check;
ALTER TABLE entity_sync_map ADD CONSTRAINT entity_sync_map_provider_check
  CHECK (provider IN ('jobber', 'hubspot', 'square', 'servicetitan'));
