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
-- In a real app, you'd use a more secure hash like bcrypt. 
-- For this PoC/Dev environment, we'll do a simple check.
CREATE OR REPLACE FUNCTION authenticate_user(p_email TEXT, p_password TEXT)
RETURNS TABLE (
    success BOOLEAN,
    tenant_id UUID,
    user_id UUID,
    user_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        TRUE,
        u.tenant_id,
        u.id,
        u.full_name
    FROM users u
    WHERE u.email = p_email AND u.password_hash = p_password; -- Simple check for PoC

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;
