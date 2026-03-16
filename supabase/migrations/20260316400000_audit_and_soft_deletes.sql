-- BUG-037: Audit logging table
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data JSONB,
  new_data JSONB,
  changed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_tenant ON audit_log(tenant_id);
CREATE INDEX idx_audit_log_table_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_tenant_isolation ON audit_log
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT ON audit_log TO api_user;

-- Generic audit trigger function
CREATE OR REPLACE FUNCTION fn_audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (tenant_id, table_name, record_id, action, new_data, changed_by)
    VALUES (NEW.tenant_id, TG_TABLE_NAME, NEW.id::text, 'INSERT', to_jsonb(NEW),
            current_setting('app.current_tenant_id', true));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (tenant_id, table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (NEW.tenant_id, TG_TABLE_NAME, NEW.id::text, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW),
            current_setting('app.current_tenant_id', true));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log (tenant_id, table_name, record_id, action, old_data, changed_by)
    VALUES (OLD.tenant_id, TG_TABLE_NAME, OLD.id::text, 'DELETE', to_jsonb(OLD),
            current_setting('app.current_tenant_id', true));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach audit triggers to key tables
CREATE TRIGGER trg_audit_appointments
  AFTER INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_audit_customers
  AFTER INSERT OR UPDATE OR DELETE ON customers
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_audit_resources
  AFTER INSERT OR UPDATE OR DELETE ON resources
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

-- BUG-038: Soft deletes
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE resources ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial indexes for efficient filtering of active records
CREATE INDEX IF NOT EXISTS idx_appointments_active ON appointments(tenant_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(tenant_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_resources_active ON resources(tenant_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(tenant_id) WHERE is_deleted = false;

-- BUG-030: Function to link orphaned call_transcripts via appointment call_id
CREATE OR REPLACE FUNCTION link_orphaned_transcripts(p_tenant_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_linked INTEGER := 0;
BEGIN
  -- Link transcripts that share a call_id with an appointment that has a customer
  WITH linked AS (
    UPDATE call_transcripts ct
    SET customer_id = a.customer_id
    FROM appointments a
    WHERE ct.tenant_id = p_tenant_id
      AND ct.customer_id IS NULL
      AND a.tenant_id = p_tenant_id
      AND a.call_id IS NOT NULL
      AND a.customer_id IS NOT NULL
      AND ct.call_id = a.call_id
    RETURNING ct.id
  )
  SELECT count(*) INTO v_linked FROM linked;

  RETURN v_linked;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
