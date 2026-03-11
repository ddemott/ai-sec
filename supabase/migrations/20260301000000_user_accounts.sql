-- Migration to add User Accounts for Multi-Tenancy

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_isolation_users' AND tablename = 'users') THEN
        CREATE POLICY user_isolation_users ON users USING (tenant_id = current_setting('request.jwt.claim.tenant_id', true)::uuid);
    END IF;
END $$;

-- Note: User authentication is handled in the application layer (src/index.ts)
-- using bcrypt for secure password hashing.
