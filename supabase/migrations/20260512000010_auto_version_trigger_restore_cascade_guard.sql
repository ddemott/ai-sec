-- Restore two behaviors my prior trigger rewrite dropped:
--   1. SECURITY DEFINER attribute (required so the trigger can INSERT
--      into record_versions despite RLS on the audit table).
--   2. The cascade-delete guard that skips versioning when the parent
--      tenant row no longer exists. Without it, `DELETE FROM tenants
--      WHERE id = $X` fires CASCADE DELETE on customers / employees /
--      services / resources / voice_sessions / appointments, each of
--      which fires auto_version_trigger which INSERTs into
--      record_versions with tenant_id=$X — but $X is about to be
--      deleted in the same transaction, so the FK
--      record_versions_tenant_id_fkey rejects the INSERT.
--
-- The prior pilot's tests didn't trigger this because they didn't delete
-- tenants with versioned children. The unanswered-questions cascade test
-- does, and surfaced the gap.
--
-- Also: changed default `v_change_source` from 'system' back to 'local'
-- (matches the pre-rewrite default).

CREATE OR REPLACE FUNCTION auto_version_trigger()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
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
  v_pk_column := CASE TG_TABLE_NAME
    WHEN 'voice_sessions' THEN 'voice_session_id'
    WHEN 'services' THEN 'service_id'
    ELSE 'id'
  END;

  IF TG_OP = 'DELETE' THEN
    v_tenant_id := OLD.tenant_id;
  ELSE
    v_tenant_id := NEW.tenant_id;
  END IF;

  -- Skip versioning if the tenant no longer exists (cascade delete in
  -- progress). Without this guard, deleting a tenant with any child
  -- rows fails on the FK constraint to record_versions.
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM tenants WHERE id = v_tenant_id
  ) THEN
    RETURN OLD;
  END IF;

  v_change_source := COALESCE(current_setting('app.change_source', true), 'local');
  IF v_change_source = '' THEN v_change_source := 'local'; END IF;

  IF TG_OP = 'INSERT' THEN
    v_change_type := 'create';
    v_change_summary := 'Record created';
  ELSIF TG_OP = 'UPDATE' THEN
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
      FOR v_key IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
        IF v_key NOT IN ('updated_at', 'created_at') THEN
          IF (to_jsonb(NEW) -> v_key) IS DISTINCT FROM (to_jsonb(OLD) -> v_key) THEN
            v_changed_fields := array_append(v_changed_fields, v_key);
            v_previous_values := v_previous_values || jsonb_build_object(v_key, to_jsonb(OLD) -> v_key);
          END IF;
        END IF;
      END LOOP;

      IF array_length(v_changed_fields, 1) IS NULL THEN
        RETURN NEW;
      END IF;

      v_change_summary := generate_change_summary(v_changed_fields, v_previous_values, to_jsonb(NEW));
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_change_type := 'delete';
    v_change_summary := 'Record permanently deleted';
  END IF;

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
