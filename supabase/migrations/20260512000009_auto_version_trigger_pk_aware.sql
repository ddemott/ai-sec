-- Fix the auto_version_trigger function to handle PK column renames.
--
-- Background: auto_version_trigger fires on INSERT/UPDATE/DELETE for
-- 6 versioned tables (customers, appointments, voice_sessions, employees,
-- services, resources). The old body referenced OLD.id / NEW.id, which
-- worked when every table had a column literally named `id`. After the
-- PK naming convention conversion (per CODING_STANDARDS.md), each
-- table's PK is named `<table_singular>_id`, so OLD.id no longer exists
-- for renamed tables and the trigger throws
-- `record "new" has no field "id"`.
--
-- This pilot (services.id → service_id) is the first one that surfaced
-- the bug because the services suite has many INSERT tests. voice_sessions
-- (renamed earlier today) and other renamed tables would have hit the
-- same error eventually — they just don't have a trigger-firing insert
-- in their test paths.
--
-- Fix: read the PK from `to_jsonb(NEW/OLD)` via a CASE that maps
-- TG_TABLE_NAME to the convention-correct column name. Falls back to
-- `id` for tables not yet renamed. Each future PK rename appends one
-- CASE branch to this function.

CREATE OR REPLACE FUNCTION auto_version_trigger()
RETURNS TRIGGER AS $$
DECLARE
  v_tenant_id UUID;
  v_change_type TEXT;
  v_changed_fields TEXT[] := '{}';
  v_previous_values JSONB := '{}';
  v_change_source TEXT;
  v_change_summary TEXT;
  v_key TEXT;
  v_pk_column TEXT;
  v_record_id UUID;
BEGIN
  -- Resolve the PK column name from the table name. As tables get
  -- renamed under the `<table_singular>_id` convention, add their case
  -- here. Unlisted tables fall back to the legacy `id` column.
  v_pk_column := CASE TG_TABLE_NAME
    WHEN 'voice_sessions' THEN 'voice_session_id'
    WHEN 'services' THEN 'service_id'
    -- not yet renamed (will be added per pilot): customers, appointments,
    -- employees, resources
    ELSE 'id'
  END;

  -- Determine tenant_id
  IF TG_OP = 'DELETE' THEN
    v_tenant_id := OLD.tenant_id;
  ELSE
    v_tenant_id := NEW.tenant_id;
  END IF;

  -- Determine source from session var, fallback to 'system'
  v_change_source := COALESCE(current_setting('app.change_source', true), 'system');
  IF v_change_source = '' THEN v_change_source := 'system'; END IF;

  IF TG_OP = 'INSERT' THEN
    v_change_type := 'create';
    v_change_summary := 'Record created';
  ELSIF TG_OP = 'UPDATE' THEN
    -- Detect soft delete and restore
    IF (to_jsonb(OLD) ->> 'is_deleted')::BOOLEAN IS DISTINCT FROM (to_jsonb(NEW) ->> 'is_deleted')::BOOLEAN THEN
      IF (to_jsonb(NEW) ->> 'is_deleted')::BOOLEAN = true THEN
        v_change_type := 'delete';
        v_change_summary := 'Record soft-deleted';
      ELSE
        v_change_type := 'restore';
        v_change_summary := 'Record restored from soft-delete';
      END IF;
    ELSE
      v_change_type := 'update';
      -- Find which fields changed
      FOR v_key IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
        IF v_key NOT IN ('updated_at', 'created_at') THEN
          IF (to_jsonb(NEW) -> v_key) IS DISTINCT FROM (to_jsonb(OLD) -> v_key) THEN
            v_changed_fields := array_append(v_changed_fields, v_key);
            v_previous_values := v_previous_values || jsonb_build_object(v_key, to_jsonb(OLD) -> v_key);
          END IF;
        END IF;
      END LOOP;

      -- Skip if nothing actually changed
      IF array_length(v_changed_fields, 1) IS NULL THEN
        RETURN NEW;
      END IF;

      v_change_summary := generate_change_summary(v_changed_fields, v_previous_values, to_jsonb(NEW));
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_change_type := 'delete';
    v_change_summary := 'Record permanently deleted';
  END IF;

  -- Create version snapshot
  IF TG_OP = 'DELETE' THEN
    v_record_id := (to_jsonb(OLD) ->> v_pk_column)::UUID;
    PERFORM create_record_version(
      v_tenant_id, TG_TABLE_NAME, v_record_id,
      to_jsonb(OLD), v_changed_fields, v_previous_values,
      v_change_type, v_change_source,
      current_setting('app.changed_by', true),
      v_change_summary
    );
    RETURN OLD;
  ELSE
    v_record_id := (to_jsonb(NEW) ->> v_pk_column)::UUID;
    PERFORM create_record_version(
      v_tenant_id, TG_TABLE_NAME, v_record_id,
      to_jsonb(NEW), v_changed_fields, v_previous_values,
      v_change_type, v_change_source,
      current_setting('app.changed_by', true),
      v_change_summary
    );
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;
