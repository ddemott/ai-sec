-- Migration: Create services table for scheduling
-- This table stores service definitions (name, duration, required skills/resources)

CREATE TABLE IF NOT EXISTS services (
    id SERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    duration_minutes INTEGER NOT NULL,
    required_skills TEXT[],
    required_resources TEXT[],
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for fast lookup by tenant
CREATE INDEX IF NOT EXISTS idx_services_tenant_id ON services(tenant_id);

-- Example RLS policy (adjust as needed)
-- Enable RLS
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
-- Allow tenant to access their own services
