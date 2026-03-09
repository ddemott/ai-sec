-- Migration: Fix service_resource table, types, and policies
-- Ensure resource_id is UUID and tenant_id is present for RLS

-- 1. Drop and recreate service_resource with correct types
DROP TABLE IF EXISTS service_resource CASCADE;
CREATE TABLE service_resource (
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    PRIMARY KEY (service_id, resource_id)
);

-- 2. Enable RLS
ALTER TABLE service_resource ENABLE ROW LEVEL SECURITY;

-- 3. Apply tenant isolation policy
DROP POLICY IF EXISTS service_resource_tenant_access ON service_resource;
CREATE POLICY service_resource_tenant_access ON service_resource 
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- 4. Standardize service_employee RLS as well (just in case)
-- Ensure tenant_id exists (it's added in a previous migration, but we want to be sure it's correct)
ALTER TABLE service_employee ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

-- Apply policy to service_employee
DROP POLICY IF EXISTS service_employee_tenant_access ON service_employee;
CREATE POLICY service_employee_tenant_access ON service_employee 
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
