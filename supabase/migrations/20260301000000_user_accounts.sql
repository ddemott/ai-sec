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

-- Policy: Users can only see their own user record
CREATE POLICY user_isolation_users ON users 
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- Function to authenticate a user and return tenant_id
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
