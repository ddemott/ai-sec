-- Enable RLS on all tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE soft_reservations ENABLE ROW LEVEL SECURITY;

-- Define Policies based on app.current_tenant_id (Idempotent)
DO $$
BEGIN
    DROP POLICY IF EXISTS tenant_isolation_tenants ON tenants;
    CREATE POLICY tenant_isolation_tenants ON tenants USING (id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

    DROP POLICY IF EXISTS tenant_isolation_resources ON resources;
    CREATE POLICY tenant_isolation_resources ON resources USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

    DROP POLICY IF EXISTS tenant_isolation_customers ON customers;
    CREATE POLICY tenant_isolation_customers ON customers USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

    DROP POLICY IF EXISTS tenant_isolation_appointments ON appointments;
    CREATE POLICY tenant_isolation_appointments ON appointments USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

    DROP POLICY IF EXISTS tenant_isolation_call_summaries ON call_summaries;
    CREATE POLICY tenant_isolation_call_summaries ON call_summaries USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

    DROP POLICY IF EXISTS tenant_isolation_call_transcripts ON call_transcripts;
    CREATE POLICY tenant_isolation_call_transcripts ON call_transcripts USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

    DROP POLICY IF EXISTS tenant_isolation_soft_reservations ON soft_reservations;
    CREATE POLICY tenant_isolation_soft_reservations ON soft_reservations USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
END
$$;

-- Create a helper function to set the tenant context
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', p_tenant_id::TEXT, FALSE);
END;
$$ LANGUAGE plpgsql;
