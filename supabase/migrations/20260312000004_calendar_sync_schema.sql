-- Calendar Sync Schema
CREATE TABLE IF NOT EXISTS tenant_calendar_settings (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook')),
    external_calendar_id TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appointment_sync_map (
    appointment_id UUID PRIMARY KEY REFERENCES appointments(id) ON DELETE CASCADE,
    external_event_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'outlook')),
    last_synced_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE tenant_calendar_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_sync_map ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Tenant isolation for calendar settings" ON tenant_calendar_settings
    FOR ALL USING (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::UUID);

-- For the sync map, we join via appointments to get tenant_id context
CREATE POLICY "Tenant isolation for sync map" ON appointment_sync_map
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.id = appointment_id
              AND a.tenant_id = (SELECT current_setting('app.current_tenant_id', true))::UUID
        )
    );
