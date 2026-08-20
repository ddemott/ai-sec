-- Pilot migration for the PK naming convention locked in CLAUDE.md
-- 2026-05-11: every single-column PK is named `<table_singular>_id`, never bare `id`.
--
-- Picked record_versions as the pilot because:
--   - Zero inbound FKs (no other table references record_versions.<pk>)
--   - No junction-table complexity
--   - Real consumer code (src/routes/versionHistory.ts + dashboard
--     RecordHistoryModal + version-history-restore.spec.ts E2E)
--   - Bounded surface: 1 table, 2 SQL functions, 1 view
--
-- What this migration does:
--   1. ALTER TABLE record_versions RENAME COLUMN id TO record_version_id
--   2. CREATE OR REPLACE the two functions that reference rv.id
--      (create_record_version uses RETURNING; get_record_history selects it)
--   3. CREATE OR REPLACE the recent_record_changes view (selects rv.id)
--
-- What this migration does NOT do:
--   - Rename other tables' `id` columns. Each table gets its own migration
--     once the pilot proves the pattern + cost.
--   - Touch FK columns. They were already `<table>_id`; symmetry emerges
--     automatically once the PK matches.

ALTER TABLE record_versions RENAME COLUMN id TO record_version_id;

-- ── create_record_version ────────────────────────────────────────────
-- Recreated to update RETURNING and the parameter binding. Body otherwise
-- unchanged from the original 20260409100000 migration.

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
  v_record_version_id UUID;
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
  RETURNING record_version_id INTO v_record_version_id;

  RETURN v_record_version_id;
END;
$$ LANGUAGE plpgsql;

-- ── get_record_history ───────────────────────────────────────────────
-- Output column renamed from version_id to record_version_id so the
-- RPC's contract matches the table's column name. Callers (the route's
-- RecordHistoryRow type) update accordingly. Must DROP before CREATE
-- because RETURNS TABLE shape changes (Postgres won't replace functions
-- whose row-shape signature differs).

DROP FUNCTION IF EXISTS get_record_history(UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION get_record_history(
  p_tenant_id UUID,
  p_table_name TEXT,
  p_record_id UUID
) RETURNS TABLE (
  record_version_id UUID,
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
    rv.record_version_id,
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

-- ── recent_record_changes view ───────────────────────────────────────
-- DROP before CREATE: CREATE OR REPLACE VIEW refuses to rename columns
-- in the output. The view has no dependents, so dropping is safe.

DROP VIEW IF EXISTS recent_record_changes;

CREATE OR REPLACE VIEW recent_record_changes AS
SELECT
  rv.record_version_id,
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

