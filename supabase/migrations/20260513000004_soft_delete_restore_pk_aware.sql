-- Soft-delete + restore RPCs are PK-rename aware.
--
-- WHY this exists. `soft_delete_record()` and `restore_deleted_record()`
-- both build dynamic SQL of the form:
--
--   EXECUTE format('… FROM %I t WHERE id = $1 AND tenant_id = $2', p_table_name)
--
-- The `id` column reference was hardcoded — which broke for every
-- renamed table after the May 12 PK rename sprint. Live symptom:
-- `POST /records/customers/<uuid>/soft-delete` → 500 with
-- `column "id" does not exist`. The RPC bodies were never recreated
-- by the rename migrations because the rename sweep audit looked for
-- `\.id\b` (alias-qualified column refs) and missed the bare `WHERE id`
-- pattern hidden inside `format(...)` strings. Caught 2026-05-13
-- when the version-history-restore E2E was re-run against the
-- post-rename schema.
--
-- WHAT we change. Both functions now look up the table's PK column
-- name from `information_schema` at the top of the function body, then
-- format every dynamic SQL statement with the looked-up name. This is
-- self-healing: any future PK rename (including ones that don't follow
-- the `<table_singular>_id` convention) Just Works without touching
-- these functions again. Cost is one extra SELECT per call against a
-- catalog table that's already cached by Postgres — negligible vs the
-- network round-trip the calling route is already paying.
--
-- WHERE the soft-delete surface lives. VERSIONED_TABLES in
-- src/routes/versionHistory.ts whitelists which tables can be passed
-- as `p_table_name`. All of them have a single-column PK (the
-- whitelist excludes junction tables), so the lookup returns exactly
-- one row in normal use. We use LIMIT 1 as belt-and-braces against a
-- future schema where the whitelist accidentally grows to include a
-- composite-PK table — the function would still produce valid SQL
-- against one of the composite columns, not throw at runtime.
--
-- The function signatures and return shapes are unchanged — callers
-- in versionHistory.ts continue to work without any code change.

-- ── soft_delete_record ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.soft_delete_record(
  p_tenant_id     UUID,
  p_table_name    TEXT,
  p_record_id     UUID,
  p_deleted_by    TEXT,
  p_change_source TEXT DEFAULT 'local'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $function$
DECLARE
  v_record  JSONB;
  v_pk_col  TEXT;
BEGIN
  -- Find the PK column for the target table. Whitelisted tables have
  -- exactly one PK column; LIMIT 1 guards against a future composite-PK
  -- entry sneaking onto the whitelist.
  SELECT kcu.column_name INTO v_pk_col
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    USING (constraint_name, table_schema, table_name)
  WHERE tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name = p_table_name
  ORDER BY kcu.ordinal_position
  LIMIT 1;

  IF v_pk_col IS NULL THEN
    -- Table doesn't exist OR has no PK. Either way, can't soft-delete it.
    RETURN false;
  END IF;

  -- Snapshot current row.
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE %I = $1 AND tenant_id = $2',
    p_table_name, v_pk_col
  ) INTO v_record USING p_record_id, p_tenant_id;

  IF v_record IS NULL THEN
    RETURN false;
  END IF;

  -- Create version snapshot before delete (no change to call shape).
  PERFORM create_record_version(
    p_tenant_id, p_table_name, p_record_id,
    v_record,
    ARRAY['is_deleted', 'deleted_at', 'deleted_by'],
    jsonb_build_object('is_deleted', false, 'deleted_at', NULL, 'deleted_by', NULL),
    'delete',
    p_change_source,
    p_deleted_by,
    'Record soft deleted'
  );

  -- Perform soft delete.
  EXECUTE format(
    'UPDATE %I SET is_deleted = true, deleted_at = now(), deleted_by = $1 WHERE %I = $2 AND tenant_id = $3',
    p_table_name, v_pk_col
  ) USING p_deleted_by, p_record_id, p_tenant_id;

  RETURN true;
END;
$function$;

-- ── restore_deleted_record ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.restore_deleted_record(
  p_tenant_id     UUID,
  p_table_name    TEXT,
  p_record_id     UUID,
  p_restored_by   TEXT,
  p_change_source TEXT DEFAULT 'local'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $function$
DECLARE
  v_record  JSONB;
  v_pk_col  TEXT;
BEGIN
  -- Same PK lookup as soft_delete_record; see notes there.
  SELECT kcu.column_name INTO v_pk_col
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    USING (constraint_name, table_schema, table_name)
  WHERE tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name = p_table_name
  ORDER BY kcu.ordinal_position
  LIMIT 1;

  IF v_pk_col IS NULL THEN
    RETURN false;
  END IF;

  -- Snapshot the deleted row before restoring (only restores rows that
  -- are currently soft-deleted).
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE %I = $1 AND tenant_id = $2 AND is_deleted = true',
    p_table_name, v_pk_col
  ) INTO v_record USING p_record_id, p_tenant_id;

  IF v_record IS NULL THEN
    RETURN false;
  END IF;

  -- Restore.
  EXECUTE format(
    'UPDATE %I SET is_deleted = false, deleted_at = NULL, deleted_by = NULL WHERE %I = $1 AND tenant_id = $2',
    p_table_name, v_pk_col
  ) USING p_record_id, p_tenant_id;

  -- Snapshot the restored row for the version log.
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE %I = $1 AND tenant_id = $2',
    p_table_name, v_pk_col
  ) INTO v_record USING p_record_id, p_tenant_id;

  PERFORM create_record_version(
    p_tenant_id, p_table_name, p_record_id,
    v_record,
    ARRAY['is_deleted', 'deleted_at', 'deleted_by'],
    jsonb_build_object(
      'is_deleted', true,
      'deleted_at', v_record->>'deleted_at',
      'deleted_by', v_record->>'deleted_by'
    ),
    'restore',
    p_change_source,
    p_restored_by,
    'Record restored from deletion'
  );

  RETURN true;
END;
$function$;

