-- Fix auto_version_trigger to skip when the tenant is being
-- cascade-deleted.
--
-- Same bug pattern that 20260319000003 fixed for fn_audit_trigger.
-- When `DELETE FROM tenants WHERE id = X` runs, Postgres cascade-deletes
-- all child rows (customers, appointments, employees, etc.). Each
-- child DELETE fires `auto_version_trigger`, which then tries to
-- INSERT a row into `record_versions` referencing the about-to-be-gone
-- tenant_id. Postgres rejects the INSERT with:
--
--   insert or update on table "record_versions" violates foreign key
--   constraint "record_versions_tenant_id_fkey"
--
-- which makes the entire DELETE transaction fail. Tenants couldn't be
-- deleted at all once they had any child rows tracked by auto-version.
--
-- Fix: short-circuit on DELETE if the tenant row no longer exists.
-- The cascade delete will clean up all the record_versions rows
-- anyway via record_versions_tenant_id_fkey ON DELETE CASCADE, so
-- skipping the INSERT here doesn't lose history — the parent tenant
-- and all its child records are being permanently destroyed in one
-- atomic transaction.

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

  -- Skip versioning if the tenant no longer exists (cascade delete in
  -- progress). Without this guard, deleting a tenant with any child
  -- rows fails on the FK constraint to record_versions.
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM tenants WHERE id = v_tenant_id
  ) THEN
    RETURN OLD;
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
