-- Jobber CRM Integration Schema
-- Adds updated_at to customers/appointments, creates integration settings + sync map tables

-- 1. Add updated_at to customers and appointments (needed for timestamp-based merge)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Backfill existing rows
UPDATE customers SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE appointments SET updated_at = created_at WHERE updated_at IS NULL;

-- Auto-update trigger function (reusable)
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_appointments_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 2. CRM integration settings (separate from calendar settings)
CREATE TABLE IF NOT EXISTS tenant_integration_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('jobber')),
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    webhook_secret TEXT,
    settings JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, provider)
);

-- 3. Polymorphic entity sync map (customers + appointments)
CREATE TABLE IF NOT EXISTS entity_sync_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('jobber')),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('customer', 'appointment')),
    local_id UUID NOT NULL,
    external_id TEXT NOT NULL,
    local_updated_at TIMESTAMPTZ,
    remote_updated_at TIMESTAMPTZ,
    last_synced_at TIMESTAMPTZ DEFAULT now(),
    sync_status TEXT CHECK (sync_status IN ('synced', 'pending', 'conflict', 'error')) DEFAULT 'synced',
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, provider, entity_type, local_id),
    UNIQUE(tenant_id, provider, entity_type, external_id)
);

-- 4. RLS
ALTER TABLE tenant_integration_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_sync_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_integration_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE entity_sync_map FORCE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for integration settings" ON tenant_integration_settings
    FOR ALL USING (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::UUID);

CREATE POLICY "Tenant isolation for entity sync map" ON entity_sync_map
    FOR ALL USING (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::UUID);

-- Admin bypass (no tenant context set = allow for backend service queries)
CREATE POLICY "Admin bypass for integration settings" ON tenant_integration_settings
    FOR ALL USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

CREATE POLICY "Admin bypass for entity sync map" ON entity_sync_map
    FOR ALL USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_entity_sync_map_external ON entity_sync_map(tenant_id, provider, entity_type, external_id);
CREATE INDEX IF NOT EXISTS idx_entity_sync_map_local ON entity_sync_map(tenant_id, provider, entity_type, local_id);
CREATE INDEX IF NOT EXISTS idx_entity_sync_map_pending ON entity_sync_map(sync_status) WHERE sync_status != 'synced';
CREATE INDEX IF NOT EXISTS idx_customers_updated_at ON customers(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_appointments_updated_at ON appointments(tenant_id, updated_at);
