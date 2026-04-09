-- Version History and Soft Delete System
-- Provides full audit trail with field-level restore capabilities

-- ============================================================================
-- 1. RECORD VERSIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS record_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  version_number INT NOT NULL,
  data JSONB NOT NULL,                    -- full record snapshot
  changed_fields TEXT[] DEFAULT '{}',     -- which fields changed (empty for create)
  previous_values JSONB DEFAULT '{}',     -- old values of changed fields
  change_type TEXT NOT NULL,              -- 'create', 'update', 'delete', 'restore', 'sync', 'merge'
  change_source TEXT NOT NULL,            -- 'local', 'hubspot', 'jobber', 'square', 'servicetitan', 'voice_call', 'system'
  changed_by TEXT,                        -- user name, email, or system identifier
  change_summary TEXT,                    -- human-readable summary of changes
  changed_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT unique_version UNIQUE(tenant_id, table_name, record_id, version_number)
);

-- Indexes for efficient queries
CREATE INDEX idx_record_versions_lookup ON record_versions(tenant_id, table_name, record_id);
CREATE INDEX idx_record_versions_changed_at ON record_versions(tenant_id, changed_at DESC);
CREATE INDEX idx_record_versions_change_source ON record_versions(tenant_id, change_source);

-- RLS for record_versions
ALTER TABLE record_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY record_versions_tenant_isolation ON record_versions
  FOR ALL
  USING (tenant_id = COALESCE(current_setting('app.current_tenant_id', true)::UUID, '00000000-0000-0000-0000-000000000000'::UUID)
         OR current_setting('app.current_tenant_id', true) = '00000000-0000-0000-0000-000000000000');


-- ============================================================================
-- 2. SOFT DELETE COLUMNS ON KEY TABLES
-- ============================================================================

-- Customers
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_is_deleted ON customers(tenant_id, is_deleted) WHERE NOT is_deleted;

-- Appointments
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT;

CREATE INDEX IF NOT EXISTS idx_appointments_is_deleted ON appointments(tenant_id, is_deleted) WHERE NOT is_deleted;

-- Voice Sessions
ALTER TABLE voice_sessions
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT;

CREATE INDEX IF NOT EXISTS idx_voice_sessions_is_deleted ON voice_sessions(tenant_id, is_deleted) WHERE NOT is_deleted;

-- Employees
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT;
-- Note: employees already has is_deleted column

-- Services
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT;

CREATE INDEX IF NOT EXISTS idx_services_is_deleted ON services(tenant_id, is_deleted) WHERE NOT is_deleted;

-- Resources
ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT;

CREATE INDEX IF NOT EXISTS idx_resources_is_deleted ON resources(tenant_id, is_deleted) WHERE NOT is_deleted;


-- ============================================================================
-- 3. HELPER FUNCTIONS
-- ============================================================================

-- Get next version number for a record
CREATE OR REPLACE FUNCTION get_next_version_number(
  p_tenant_id UUID,
  p_table_name TEXT,
  p_record_id UUID
) RETURNS INT AS $$
DECLARE
  v_max_version INT;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) INTO v_max_version
  FROM record_versions
  WHERE tenant_id = p_tenant_id
    AND table_name = p_table_name
    AND record_id = p_record_id;

  RETURN v_max_version + 1;
END;
$$ LANGUAGE plpgsql;


-- Create a version snapshot for any record
CREATE OR REPLACE FUNCTION create_record_version(
  p_tenant_id UUID,
  p_table_name TEXT,
  p_record_id UUID,
  p_data JSONB,
  p_changed_fields TEXT[],
  p_previous_values JSONB,
  p_change_type TEXT,
  p_change_source TEXT,
  p_changed_by TEXT DEFAULT NULL,
  p_change_summary TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_version_id UUID;
  v_version_number INT;
BEGIN
  v_version_number := get_next_version_number(p_tenant_id, p_table_name, p_record_id);

  INSERT INTO record_versions (
    tenant_id, table_name, record_id, version_number,
    data, changed_fields, previous_values,
    change_type, change_source, changed_by, change_summary
  ) VALUES (
    p_tenant_id, p_table_name, p_record_id, v_version_number,
    p_data, p_changed_fields, p_previous_values,
    p_change_type, p_change_source, p_changed_by, p_change_summary
  )
  RETURNING id INTO v_version_id;

  RETURN v_version_id;
END;
$$ LANGUAGE plpgsql;


-- Generate change summary from old and new values
CREATE OR REPLACE FUNCTION generate_change_summary(
  p_changed_fields TEXT[],
  p_previous_values JSONB,
  p_new_values JSONB
) RETURNS TEXT AS $$
DECLARE
  v_summary TEXT := '';
  v_field TEXT;
  v_old_val TEXT;
  v_new_val TEXT;
BEGIN
  IF array_length(p_changed_fields, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  FOREACH v_field IN ARRAY p_changed_fields LOOP
    v_old_val := COALESCE(p_previous_values->>v_field, 'null');
    v_new_val := COALESCE(p_new_values->>v_field, 'null');

    -- Truncate long values
    IF length(v_old_val) > 50 THEN
      v_old_val := substring(v_old_val from 1 for 47) || '...';
    END IF;
    IF length(v_new_val) > 50 THEN
      v_new_val := substring(v_new_val from 1 for 47) || '...';
    END IF;

    IF v_summary != '' THEN
      v_summary := v_summary || '; ';
    END IF;
    v_summary := v_summary || v_field || ': ' || v_old_val || ' → ' || v_new_val;
  END LOOP;

  RETURN v_summary;
END;
$$ LANGUAGE plpgsql;


-- Get record history with all versions
CREATE OR REPLACE FUNCTION get_record_history(
  p_tenant_id UUID,
  p_table_name TEXT,
  p_record_id UUID
) RETURNS TABLE (
  version_id UUID,
  version_number INT,
  data JSONB,
  changed_fields TEXT[],
  previous_values JSONB,
  change_type TEXT,
  change_source TEXT,
  changed_by TEXT,
  change_summary TEXT,
  changed_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    rv.id,
    rv.version_number,
    rv.data,
    rv.changed_fields,
    rv.previous_values,
    rv.change_type,
    rv.change_source,
    rv.changed_by,
    rv.change_summary,
    rv.changed_at
  FROM record_versions rv
  WHERE rv.tenant_id = p_tenant_id
    AND rv.table_name = p_table_name
    AND rv.record_id = p_record_id
  ORDER BY rv.version_number DESC;
END;
$$ LANGUAGE plpgsql;


-- Get a specific version of a record
CREATE OR REPLACE FUNCTION get_record_version(
  p_tenant_id UUID,
  p_table_name TEXT,
  p_record_id UUID,
  p_version_number INT
) RETURNS JSONB AS $$
DECLARE
  v_data JSONB;
BEGIN
  SELECT data INTO v_data
  FROM record_versions
  WHERE tenant_id = p_tenant_id
    AND table_name = p_table_name
    AND record_id = p_record_id
    AND version_number = p_version_number;

  RETURN v_data;
END;
$$ LANGUAGE plpgsql;


-- Compare two versions and return differences
CREATE OR REPLACE FUNCTION compare_versions(
  p_tenant_id UUID,
  p_table_name TEXT,
  p_record_id UUID,
  p_version_a INT,
  p_version_b INT
) RETURNS TABLE (
  field_name TEXT,
  value_a JSONB,
  value_b JSONB
) AS $$
DECLARE
  v_data_a JSONB;
  v_data_b JSONB;
  v_key TEXT;
BEGIN
  -- Get both versions
  SELECT data INTO v_data_a
  FROM record_versions
  WHERE tenant_id = p_tenant_id AND table_name = p_table_name
    AND record_id = p_record_id AND version_number = p_version_a;

  SELECT data INTO v_data_b
  FROM record_versions
  WHERE tenant_id = p_tenant_id AND table_name = p_table_name
    AND record_id = p_record_id AND version_number = p_version_b;

  -- Compare all keys from both versions
  FOR v_key IN
    SELECT DISTINCT k FROM (
      SELECT jsonb_object_keys(v_data_a) AS k
      UNION
      SELECT jsonb_object_keys(v_data_b) AS k
    ) keys
  LOOP
    IF v_data_a->v_key IS DISTINCT FROM v_data_b->v_key THEN
      field_name := v_key;
      value_a := v_data_a->v_key;
      value_b := v_data_b->v_key;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;


-- Soft delete a record and create version
CREATE OR REPLACE FUNCTION soft_delete_record(
  p_tenant_id UUID,
  p_table_name TEXT,
  p_record_id UUID,
  p_deleted_by TEXT,
  p_change_source TEXT DEFAULT 'local'
) RETURNS BOOLEAN AS $$
DECLARE
  v_record JSONB;
BEGIN
  -- Get current record data based on table
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE id = $1 AND tenant_id = $2',
    p_table_name
  ) INTO v_record USING p_record_id, p_tenant_id;

  IF v_record IS NULL THEN
    RETURN false;
  END IF;

  -- Create version snapshot before delete
  PERFORM create_record_version(
    p_tenant_id, p_table_name, p_record_id,
    v_record,
    ARRAY['is_deleted', 'deleted_at', 'deleted_by'],
    jsonb_build_object('is_deleted', false, 'deleted_at', null, 'deleted_by', null),
    'delete',
    p_change_source,
    p_deleted_by,
    'Record soft deleted'
  );

  -- Perform soft delete
  EXECUTE format(
    'UPDATE %I SET is_deleted = true, deleted_at = now(), deleted_by = $1 WHERE id = $2 AND tenant_id = $3',
    p_table_name
  ) USING p_deleted_by, p_record_id, p_tenant_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql;


-- Restore a soft-deleted record
CREATE OR REPLACE FUNCTION restore_deleted_record(
  p_tenant_id UUID,
  p_table_name TEXT,
  p_record_id UUID,
  p_restored_by TEXT,
  p_change_source TEXT DEFAULT 'local'
) RETURNS BOOLEAN AS $$
DECLARE
  v_record JSONB;
BEGIN
  -- Get current record data
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE id = $1 AND tenant_id = $2 AND is_deleted = true',
    p_table_name
  ) INTO v_record USING p_record_id, p_tenant_id;

  IF v_record IS NULL THEN
    RETURN false;
  END IF;

  -- Restore the record
  EXECUTE format(
    'UPDATE %I SET is_deleted = false, deleted_at = NULL, deleted_by = NULL WHERE id = $1 AND tenant_id = $2',
    p_table_name
  ) USING p_record_id, p_tenant_id;

  -- Get updated record for version snapshot
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE id = $1 AND tenant_id = $2',
    p_table_name
  ) INTO v_record USING p_record_id, p_tenant_id;

  -- Create version snapshot
  PERFORM create_record_version(
    p_tenant_id, p_table_name, p_record_id,
    v_record,
    ARRAY['is_deleted', 'deleted_at', 'deleted_by'],
    jsonb_build_object('is_deleted', true, 'deleted_at', v_record->>'deleted_at', 'deleted_by', v_record->>'deleted_by'),
    'restore',
    p_change_source,
    p_restored_by,
    'Record restored from deletion'
  );

  RETURN true;
END;
$$ LANGUAGE plpgsql;


-- Restore specific fields from a historical version
CREATE OR REPLACE FUNCTION restore_fields_from_version(
  p_tenant_id UUID,
  p_table_name TEXT,
  p_record_id UUID,
  p_source_version INT,
  p_fields TEXT[],
  p_restored_by TEXT,
  p_change_source TEXT DEFAULT 'local'
) RETURNS JSONB AS $$
DECLARE
  v_current_record JSONB;
  v_source_record JSONB;
  v_new_record JSONB;
  v_field TEXT;
  v_previous_values JSONB := '{}';
  v_update_set TEXT := '';
  v_change_summary TEXT := '';
BEGIN
  -- Get current record
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE id = $1 AND tenant_id = $2',
    p_table_name
  ) INTO v_current_record USING p_record_id, p_tenant_id;

  IF v_current_record IS NULL THEN
    RAISE EXCEPTION 'Record not found';
  END IF;

  -- Get source version
  SELECT data INTO v_source_record
  FROM record_versions
  WHERE tenant_id = p_tenant_id
    AND table_name = p_table_name
    AND record_id = p_record_id
    AND version_number = p_source_version;

  IF v_source_record IS NULL THEN
    RAISE EXCEPTION 'Source version not found';
  END IF;

  -- Build update statement and track changes
  v_new_record := v_current_record;

  FOREACH v_field IN ARRAY p_fields LOOP
    -- Skip system fields
    IF v_field IN ('id', 'tenant_id', 'created_at') THEN
      CONTINUE;
    END IF;

    -- Track previous value
    v_previous_values := v_previous_values || jsonb_build_object(v_field, v_current_record->v_field);

    -- Update new record
    v_new_record := jsonb_set(v_new_record, ARRAY[v_field], COALESCE(v_source_record->v_field, 'null'::jsonb));

    -- Build summary
    IF v_change_summary != '' THEN
      v_change_summary := v_change_summary || '; ';
    END IF;
    v_change_summary := v_change_summary || v_field || ' restored from v' || p_source_version;
  END LOOP;

  -- Build dynamic UPDATE statement
  SELECT string_agg(format('%I = $1->%L', f, f), ', ')
  INTO v_update_set
  FROM unnest(p_fields) AS f
  WHERE f NOT IN ('id', 'tenant_id', 'created_at');

  -- Execute update
  IF v_update_set IS NOT NULL AND v_update_set != '' THEN
    EXECUTE format(
      'UPDATE %I SET %s, updated_at = now() WHERE id = $2 AND tenant_id = $3',
      p_table_name, v_update_set
    ) USING v_new_record, p_record_id, p_tenant_id;
  END IF;

  -- Get final record state
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE id = $1 AND tenant_id = $2',
    p_table_name
  ) INTO v_new_record USING p_record_id, p_tenant_id;

  -- Create version snapshot
  PERFORM create_record_version(
    p_tenant_id, p_table_name, p_record_id,
    v_new_record,
    p_fields,
    v_previous_values,
    'restore',
    p_change_source,
    p_restored_by,
    v_change_summary
  );

  RETURN v_new_record;
END;
$$ LANGUAGE plpgsql;


-- Copy fields from one record (including deleted) to another
CREATE OR REPLACE FUNCTION copy_fields_between_records(
  p_tenant_id UUID,
  p_table_name TEXT,
  p_source_record_id UUID,
  p_target_record_id UUID,
  p_fields TEXT[],
  p_copied_by TEXT,
  p_change_source TEXT DEFAULT 'local'
) RETURNS JSONB AS $$
DECLARE
  v_source_record JSONB;
  v_target_record JSONB;
  v_new_target JSONB;
  v_field TEXT;
  v_previous_values JSONB := '{}';
  v_update_set TEXT := '';
  v_change_summary TEXT;
BEGIN
  -- Get source record (including deleted)
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE id = $1 AND tenant_id = $2',
    p_table_name
  ) INTO v_source_record USING p_source_record_id, p_tenant_id;

  IF v_source_record IS NULL THEN
    RAISE EXCEPTION 'Source record not found';
  END IF;

  -- Get target record (must not be deleted)
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE id = $1 AND tenant_id = $2 AND (is_deleted = false OR is_deleted IS NULL)',
    p_table_name
  ) INTO v_target_record USING p_target_record_id, p_tenant_id;

  IF v_target_record IS NULL THEN
    RAISE EXCEPTION 'Target record not found or is deleted';
  END IF;

  -- Build changes
  v_new_target := v_target_record;

  FOREACH v_field IN ARRAY p_fields LOOP
    IF v_field IN ('id', 'tenant_id', 'created_at') THEN
      CONTINUE;
    END IF;

    v_previous_values := v_previous_values || jsonb_build_object(v_field, v_target_record->v_field);
    v_new_target := jsonb_set(v_new_target, ARRAY[v_field], COALESCE(v_source_record->v_field, 'null'::jsonb));
  END LOOP;

  -- Build UPDATE
  SELECT string_agg(format('%I = $1->%L', f, f), ', ')
  INTO v_update_set
  FROM unnest(p_fields) AS f
  WHERE f NOT IN ('id', 'tenant_id', 'created_at');

  -- Execute update
  IF v_update_set IS NOT NULL AND v_update_set != '' THEN
    EXECUTE format(
      'UPDATE %I SET %s, updated_at = now() WHERE id = $2 AND tenant_id = $3',
      p_table_name, v_update_set
    ) USING v_new_target, p_target_record_id, p_tenant_id;
  END IF;

  -- Get final state
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE id = $1 AND tenant_id = $2',
    p_table_name
  ) INTO v_new_target USING p_target_record_id, p_tenant_id;

  -- Change summary
  v_change_summary := 'Copied ' || array_to_string(p_fields, ', ') || ' from record ' || p_source_record_id::text;

  -- Create version
  PERFORM create_record_version(
    p_tenant_id, p_table_name, p_target_record_id,
    v_new_target,
    p_fields,
    v_previous_values,
    'merge',
    p_change_source,
    p_copied_by,
    v_change_summary
  );

  RETURN v_new_target;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 4. AUTO-VERSIONING TRIGGERS
-- ============================================================================

-- Generic trigger function for auto-versioning
CREATE OR REPLACE FUNCTION auto_version_trigger() RETURNS TRIGGER AS $$
DECLARE
  v_tenant_id UUID;
  v_change_type TEXT;
  v_changed_fields TEXT[] := '{}';
  v_previous_values JSONB := '{}';
  v_change_source TEXT;
  v_change_summary TEXT;
  v_key TEXT;
BEGIN
  -- Determine tenant_id
  IF TG_OP = 'DELETE' THEN
    v_tenant_id := OLD.tenant_id;
  ELSE
    v_tenant_id := NEW.tenant_id;
  END IF;

  -- Get change source from session variable (set by application)
  v_change_source := COALESCE(current_setting('app.change_source', true), 'local');

  -- Determine change type and track changes
  IF TG_OP = 'INSERT' THEN
    v_change_type := 'create';
    v_change_summary := 'Record created';

  ELSIF TG_OP = 'UPDATE' THEN
    -- Check if this is a soft delete
    IF OLD.is_deleted = false AND NEW.is_deleted = true THEN
      -- Soft delete is handled by soft_delete_record function, skip auto-version
      RETURN NEW;
    ELSIF OLD.is_deleted = true AND NEW.is_deleted = false THEN
      -- Restore is handled by restore_deleted_record function, skip auto-version
      RETURN NEW;
    END IF;

    v_change_type := 'update';

    -- Find changed fields by comparing OLD and NEW
    FOR v_key IN SELECT jsonb_object_keys(to_jsonb(OLD))
    LOOP
      IF to_jsonb(OLD)->v_key IS DISTINCT FROM to_jsonb(NEW)->v_key THEN
        -- Skip internal tracking fields
        IF v_key NOT IN ('updated_at', 'created_at') THEN
          v_changed_fields := array_append(v_changed_fields, v_key);
          v_previous_values := v_previous_values || jsonb_build_object(v_key, to_jsonb(OLD)->v_key);
        END IF;
      END IF;
    END LOOP;

    -- Skip if no meaningful changes
    IF array_length(v_changed_fields, 1) IS NULL THEN
      RETURN NEW;
    END IF;

    -- Generate summary
    v_change_summary := generate_change_summary(v_changed_fields, v_previous_values, to_jsonb(NEW));

  ELSIF TG_OP = 'DELETE' THEN
    -- Hard delete - create final version snapshot
    v_change_type := 'delete';
    v_change_summary := 'Record permanently deleted';
  END IF;

  -- Create version snapshot
  IF TG_OP = 'DELETE' THEN
    PERFORM create_record_version(
      v_tenant_id, TG_TABLE_NAME, OLD.id,
      to_jsonb(OLD), v_changed_fields, v_previous_values,
      v_change_type, v_change_source,
      current_setting('app.changed_by', true),
      v_change_summary
    );
    RETURN OLD;
  ELSE
    PERFORM create_record_version(
      v_tenant_id, TG_TABLE_NAME, NEW.id,
      to_jsonb(NEW), v_changed_fields, v_previous_values,
      v_change_type, v_change_source,
      current_setting('app.changed_by', true),
      v_change_summary
    );
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;


-- Create triggers on key tables
DROP TRIGGER IF EXISTS customers_auto_version ON customers;
CREATE TRIGGER customers_auto_version
  AFTER INSERT OR UPDATE OR DELETE ON customers
  FOR EACH ROW EXECUTE FUNCTION auto_version_trigger();

DROP TRIGGER IF EXISTS appointments_auto_version ON appointments;
CREATE TRIGGER appointments_auto_version
  AFTER INSERT OR UPDATE OR DELETE ON appointments
  FOR EACH ROW EXECUTE FUNCTION auto_version_trigger();

DROP TRIGGER IF EXISTS voice_sessions_auto_version ON voice_sessions;
CREATE TRIGGER voice_sessions_auto_version
  AFTER INSERT OR UPDATE OR DELETE ON voice_sessions
  FOR EACH ROW EXECUTE FUNCTION auto_version_trigger();

DROP TRIGGER IF EXISTS employees_auto_version ON employees;
CREATE TRIGGER employees_auto_version
  AFTER INSERT OR UPDATE OR DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION auto_version_trigger();

DROP TRIGGER IF EXISTS services_auto_version ON services;
CREATE TRIGGER services_auto_version
  AFTER INSERT OR UPDATE OR DELETE ON services
  FOR EACH ROW EXECUTE FUNCTION auto_version_trigger();

DROP TRIGGER IF EXISTS resources_auto_version ON resources;
CREATE TRIGGER resources_auto_version
  AFTER INSERT OR UPDATE OR DELETE ON resources
  FOR EACH ROW EXECUTE FUNCTION auto_version_trigger();


-- ============================================================================
-- 5. HELPER VIEWS
-- ============================================================================

-- View for deleted customers
CREATE OR REPLACE VIEW deleted_customers AS
SELECT
  c.*,
  (SELECT COUNT(*) FROM record_versions rv
   WHERE rv.record_id = c.id AND rv.table_name = 'customers') as version_count
FROM customers c
WHERE c.is_deleted = true;

-- View for recent changes across all tables
CREATE OR REPLACE VIEW recent_record_changes AS
SELECT
  rv.id,
  rv.tenant_id,
  rv.table_name,
  rv.record_id,
  rv.version_number,
  rv.change_type,
  rv.change_source,
  rv.changed_by,
  rv.change_summary,
  rv.changed_at,
  rv.data->>'name' as record_name,
  rv.data->>'phone' as record_phone
FROM record_versions rv
ORDER BY rv.changed_at DESC;
