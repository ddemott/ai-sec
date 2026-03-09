-- Migration: Unify RLS and fix mapping table security
-- This migration fixes the conflict between 'app.current_tenant_id' and 'request.jwt.claim.tenant_id'
-- and secures the mapping tables.

-- 1. Standardize set_tenant_context to handle both possible variables
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', p_tenant_id::TEXT, FALSE);
  PERFORM set_config('request.jwt.claim.tenant_id', p_tenant_id::TEXT, FALSE);
END;
$$ LANGUAGE plpgsql;

-- 2. Add tenant_id to mapping tables for secure isolation
ALTER TABLE service_resource ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE service_employee ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

-- Populate tenant_id from parent services (assuming existing data matches)
UPDATE service_resource sr SET tenant_id = s.tenant_id FROM services s WHERE sr.service_id = s.id;
UPDATE service_employee se SET tenant_id = s.tenant_id FROM services s WHERE se.service_id = s.id;

-- Make tenant_id NOT NULL now that it's populated
ALTER TABLE service_resource ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE service_employee ALTER COLUMN tenant_id SET NOT NULL;

-- 3. Enable RLS on all tables (ensure it's on)
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_resource ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_employee ENABLE ROW LEVEL SECURITY;

-- 4. Apply consistent policies to ALL tables
DO $$
BEGIN
    -- Services
    DROP POLICY IF EXISTS services_tenant_access ON services;
    CREATE POLICY services_tenant_access ON services 
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

    -- Employees
    DROP POLICY IF EXISTS employees_tenant_access ON employees;
    CREATE POLICY employees_tenant_access ON employees 
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

    -- Service-Resource Mapping
    DROP POLICY IF EXISTS service_resource_tenant_access ON service_resource;
    CREATE POLICY service_resource_tenant_access ON service_resource 
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

    -- Service-Employee Mapping
    DROP POLICY IF EXISTS service_employee_tenant_access ON service_employee;
    CREATE POLICY service_employee_tenant_access ON service_employee 
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
END
$$;
