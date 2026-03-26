-- HubSpot CRM Integration
-- Extends the integration tables created in 20260327000000 to support HubSpot

-- 1. Widen provider CHECK on tenant_integration_settings
ALTER TABLE tenant_integration_settings DROP CONSTRAINT IF EXISTS tenant_integration_settings_provider_check;
ALTER TABLE tenant_integration_settings ADD CONSTRAINT tenant_integration_settings_provider_check
  CHECK (provider IN ('jobber', 'hubspot'));

-- 2. Widen provider CHECK on entity_sync_map
ALTER TABLE entity_sync_map DROP CONSTRAINT IF EXISTS entity_sync_map_provider_check;
ALTER TABLE entity_sync_map ADD CONSTRAINT entity_sync_map_provider_check
  CHECK (provider IN ('jobber', 'hubspot'));
