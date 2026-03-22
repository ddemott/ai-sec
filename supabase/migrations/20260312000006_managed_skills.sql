-- Master list of skills/capabilities per tenant
CREATE TABLE IF NOT EXISTS tenant_skills (
    id SERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, name) -- Prevent duplicates within a business
);

-- Enable RLS
ALTER TABLE tenant_skills ENABLE ROW LEVEL SECURITY;

-- Policy
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'tenant_skills' 
        AND policyname = 'Tenant isolation for master skills'
    ) THEN
        CREATE POLICY "Tenant isolation for master skills" ON tenant_skills
            FOR ALL USING (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::UUID);
    END IF;
END
$$;

-- Seed some initial skills for DynaTire PoC (only if tenant exists)
INSERT INTO tenant_skills (tenant_id, name, description)
SELECT * FROM (VALUES
    ('f234e471-0e60-4163-86c9-93cfd9338e3a'::UUID, 'tire-rotation', 'Standard 4-tire rotation'),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a'::UUID, 'flat-repair', 'Puncture plugging and patching'),
    ('f234e471-0e60-4163-86c9-93cfd9338e3a'::UUID, 'tire-install', 'Full mount and balance of new tires')
) AS v(tenant_id, name, description)
WHERE EXISTS (SELECT 1 FROM tenants WHERE id = 'f234e471-0e60-4163-86c9-93cfd9338e3a')
ON CONFLICT DO NOTHING;
