-- ────────────────────────────────────────────────────────────────────
-- Extend the audit trail to services + employees.
--
-- Owners change service prices and staff, but those edits had no audit_log
-- entry — fn_audit_trigger only fired on appointments / customers / resources
-- (see 20260316400000). This (1) teaches the trigger function the PK columns
-- for services (service_id) and employees (employee_id), and (2) attaches the
-- AFTER INSERT/UPDATE/DELETE trigger to both tables.
--
-- The function body is otherwise unchanged from 20260512000016 (the tenant_id
-- cascade-guard fix) — only the v_pk_column CASE gains two arms.
--
-- Forward-compatible with the app: the owner-facing GET /audit-log already
-- filters by table_name, so a deploy without this migration simply shows no
-- service/employee rows yet; once applied, they appear.
-- ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_audit_trigger()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
DECLARE
  v_pk_column TEXT;
  v_record_id TEXT;
BEGIN
  v_pk_column := CASE TG_TABLE_NAME
    WHEN 'resources' THEN 'resource_id'
    WHEN 'appointments' THEN 'appointment_id'
    WHEN 'customers' THEN 'customer_id'
    WHEN 'services' THEN 'service_id'
    WHEN 'employees' THEN 'employee_id'
    ELSE 'id'
  END;

  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE tenant_id = OLD.tenant_id) THEN
      RETURN OLD;
    END IF;
    v_record_id := to_jsonb(OLD) ->> v_pk_column;
    INSERT INTO audit_log (tenant_id, table_name, record_id, action, old_data, changed_by)
    VALUES (OLD.tenant_id, TG_TABLE_NAME, v_record_id, 'DELETE', to_jsonb(OLD),
            current_setting('app.current_tenant_id', true));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    v_record_id := to_jsonb(NEW) ->> v_pk_column;
    INSERT INTO audit_log (tenant_id, table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (NEW.tenant_id, TG_TABLE_NAME, v_record_id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW),
            current_setting('app.current_tenant_id', true));
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    v_record_id := to_jsonb(NEW) ->> v_pk_column;
    INSERT INTO audit_log (tenant_id, table_name, record_id, action, new_data, changed_by)
    VALUES (NEW.tenant_id, TG_TABLE_NAME, v_record_id, 'INSERT', to_jsonb(NEW),
            current_setting('app.current_tenant_id', true));
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_services ON services;
CREATE TRIGGER trg_audit_services
  AFTER INSERT OR UPDATE OR DELETE ON services
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_employees ON employees;
CREATE TRIGGER trg_audit_employees
  AFTER INSERT OR UPDATE OR DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
