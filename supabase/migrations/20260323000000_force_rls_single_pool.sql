-- Force RLS on all tenant-scoped tables so it applies even to superusers (postgres role).
-- This is required for Supabase managed Postgres where we connect as `postgres`
-- instead of a custom `api_user` role. RLS is enforced via set_tenant_context() GUC.

ALTER TABLE appointment_sync_map FORCE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE business_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE call_summaries FORCE ROW LEVEL SECURITY;
ALTER TABLE call_transcripts FORCE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
ALTER TABLE employee_shifts FORCE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
ALTER TABLE resources FORCE ROW LEVEL SECURITY;
ALTER TABLE service_employee FORCE ROW LEVEL SECURITY;
ALTER TABLE service_resource FORCE ROW LEVEL SECURITY;
ALTER TABLE services FORCE ROW LEVEL SECURITY;
ALTER TABLE soft_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_calendar_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_docs FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_skills FORCE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE user_feedback FORCE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- Make audit trigger SECURITY DEFINER so it bypasses RLS.
-- The trigger is internal (fires on row changes) and must always be able to write to audit_log.
CREATE OR REPLACE FUNCTION fn_audit_trigger() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Skip audit if tenant no longer exists (cascade delete in progress)
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
      RETURN OLD;
    END IF;
    INSERT INTO audit_log (tenant_id, table_name, record_id, action, old_data, changed_by)
    VALUES (OLD.tenant_id, TG_TABLE_NAME, OLD.id::text, 'DELETE', to_jsonb(OLD),
            current_setting('app.current_tenant_id', true));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (tenant_id, table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (NEW.tenant_id, TG_TABLE_NAME, NEW.id::text, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW),
            current_setting('app.current_tenant_id', true));
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (tenant_id, table_name, record_id, action, new_data, changed_by)
    VALUES (NEW.tenant_id, TG_TABLE_NAME, NEW.id::text, 'INSERT', to_jsonb(NEW),
            current_setting('app.current_tenant_id', true));
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also add a bypass policy for admin operations that don't set tenant context.
-- The admin pool sets app.current_tenant_id = '' (empty), so we need policies
-- that allow access when no tenant context is set (for cross-tenant admin queries).
-- Existing policies use NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID
-- which returns NULL when empty — so they correctly deny access.
-- We add an explicit superuser/admin bypass for the tables that need cross-tenant reads.

-- Tenants table needs cross-tenant access (admin lists all tenants)
DROP POLICY IF EXISTS admin_bypass_tenants ON tenants;
CREATE POLICY admin_bypass_tenants ON tenants
    USING (NULLIF(current_setting('app.current_tenant_id', TRUE), '') IS NULL);

-- Users table needs cross-tenant access (login checks email across tenants)
DROP POLICY IF EXISTS admin_bypass_users ON users;
CREATE POLICY admin_bypass_users ON users
    USING (NULLIF(current_setting('app.current_tenant_id', TRUE), '') IS NULL);

-- Business templates are global (no tenant_id column)
DROP POLICY IF EXISTS admin_bypass_business_templates ON business_templates;
CREATE POLICY admin_bypass_business_templates ON business_templates
    USING (NULLIF(current_setting('app.current_tenant_id', TRUE), '') IS NULL);
