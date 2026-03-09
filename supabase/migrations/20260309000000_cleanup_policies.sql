-- Migration: Clean up service_resource table and policies

-- Drop service_resource if exists (to fix type mismatch)
DROP TABLE IF EXISTS service_resource CASCADE;

-- Recreate service_resource with correct types
CREATE TABLE service_resource (
    service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
    resource_id UUID REFERENCES resources(id) ON DELETE CASCADE,
    PRIMARY KEY (service_id, resource_id)
);

-- Idempotent policy creation for service_resource
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_resource_tenant_access' AND tablename = 'service_resource') THEN
        CREATE POLICY service_resource_tenant_access ON service_resource USING (true);
    END IF;
END $$;

-- Idempotent policy creation for employees
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'employees_tenant_access' AND tablename = 'employees') THEN
        CREATE POLICY employees_tenant_access ON employees USING (tenant_id = current_setting('request.jwt.claim.tenant_id', true)::uuid);
    END IF;
END $$;

-- Idempotent policy creation for services
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'services_tenant_access' AND tablename = 'services') THEN
        CREATE POLICY services_tenant_access ON services USING (tenant_id = current_setting('request.jwt.claim.tenant_id', true)::uuid);
    END IF;
END $$;

-- Idempotent policy creation for service_employee
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_employee_tenant_access' AND tablename = 'service_employee') THEN
        CREATE POLICY service_employee_tenant_access ON service_employee USING (true);
    END IF;
END $$;
