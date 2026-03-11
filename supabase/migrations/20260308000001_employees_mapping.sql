-- Migration: Add employees table and skills mapping
-- This table stores employee definitions and their skills/capabilities

CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    skills TEXT[],
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_tenant_id ON employees(tenant_id);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Migration: Add service_employee and service_resource mapping tables
CREATE TABLE IF NOT EXISTS service_employee (
    service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    PRIMARY KEY (service_id, employee_id)
);

CREATE TABLE IF NOT EXISTS service_resource (
    service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
    resource_id UUID REFERENCES resources(id) ON DELETE CASCADE,
    PRIMARY KEY (service_id, resource_id)
);

-- RLS for mapping tables
ALTER TABLE service_employee ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_resource ENABLE ROW LEVEL SECURITY;
-- Policies can be added as needed for tenant isolation.
