-- restore_fields_from_version() + copy_fields_between_records() are
-- PK-rename aware.
--
-- WHY this exists. Both functions build dynamic SQL of the form:
--
--   EXECUTE format('… FROM %I t WHERE id = $1 AND tenant_id = $2', p_table_name)
--
-- The `id` column reference was hardcoded — which broke for every
-- versioned table after the 2026-05-12 PK rename sprint (customers →
-- customer_id, appointments → appointment_id, voice_sessions →
-- voice_session_id, employees → employee_id, services → service_id,
-- resources → resource_id). Live symptom: POST /records/:table/:id/
-- restore-fields and POST /records/:table/copy-fields → 500 with
-- `column "id" does not exist`, for ALL six tables — field-level restore
-- and copy-fields were completely dead in production. Migration
-- 20260513000004 fixed the sibling functions soft_delete_record() /
-- restore_deleted_record() with an information_schema PK lookup but
-- missed these two (same root cause: the rename sweep audit looked for
-- alias-qualified `\.id\b` refs and missed bare `WHERE id` hidden inside
-- format(...) strings). Caught 2026-07-01 by the real-DB companion suite
-- src/versionHistory.realdb.test.ts — the mocked route tests never
-- execute the functions, so the breakage shipped green.
--
-- WHAT we change. Same pattern as 20260513000004: each function looks up
-- the table's PK column name from information_schema at the top of the
-- body, then formats every dynamic statement with the looked-up name.
-- Self-healing for any future PK rename. Three additional hardenings,
-- all latent bugs that were unreachable while the functions threw on
-- their first statement:
--   * the "system fields" skip list now also excludes the looked-up PK
--     column (previously only the literal 'id' was skipped, so a caller
--     passing e.g. 'customer_id' in p_fields could clobber the PK);
--   * `updated_at = now()` is appended only when the table actually has
--     an updated_at column (resources does not — the old hardcoded SET
--     would 42703 there even with the PK fixed);
--   * the SET clause previously assigned raw jsonb (`%I = $1->%L`),
--     which stringifies through the assignment cast — text columns got
--     JSON-QUOTED values (name became literally `"Versioned Vera"` with
--     the quotes). Now each column is assigned via
--     `(jsonb_populate_record(NULL::<table>, $1)).<col>`, which decodes
--     the jsonb into the column's real type (text unquoted, numerics,
--     timestamps, arrays, jsonb columns) — no per-type special-casing.
--
-- Function signatures and return types are unchanged — callers in
-- src/routes/versionHistory.ts continue to work without code changes.
--
-- PROD NOTE: fix-forward. Both functions have been broken (every call
-- raised 42703) since the PK renames landed, so redefining them cannot
-- regress any working caller.

-- ── restore_fields_from_version ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.restore_fields_from_version(
  p_tenant_id      UUID,
  p_table_name     TEXT,
  p_record_id      UUID,
  p_source_version INTEGER,
  p_fields         TEXT[],
  p_restored_by    TEXT,
  p_change_source  TEXT DEFAULT 'local'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $function$
DECLARE
  v_current_record JSONB;
  v_source_record JSONB;
  v_new_record JSONB;
  v_field TEXT;
  v_previous_values JSONB := '{}';
  v_update_set TEXT := '';
  v_change_summary TEXT := '';
  v_pk_col TEXT;
  v_has_updated_at BOOLEAN;
BEGIN
  -- Find the PK column for the target table (same lookup as
  -- soft_delete_record — see 20260513000004 for the full rationale).
  -- Whitelisted tables have exactly one PK column; LIMIT 1 guards
  -- against a future composite-PK entry sneaking onto the whitelist.
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
    -- Distinct from the record-not-found case below: NULL here means the PK
    -- LOOKUP failed (table missing from public, or no PK) — schema/whitelist
    -- drift, not a bad record id. Name it precisely for alert triage.
    RAISE EXCEPTION 'No primary key found for table % — schema/whitelist drift', p_table_name;
  END IF;

  -- Not every versioned table has updated_at (resources doesn't).
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_table_name
      AND column_name = 'updated_at'
  ) INTO v_has_updated_at;

  -- Get current record
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE %I = $1 AND tenant_id = $2',
    p_table_name, v_pk_col
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
    -- Skip system fields (incl. the table's actual PK column)
    IF v_field IN ('id', 'tenant_id', 'created_at') OR v_field = v_pk_col THEN
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

  -- Build dynamic UPDATE statement. jsonb_populate_record decodes each
  -- restored value into the column's REAL type — assigning `$1->field`
  -- (raw jsonb) instead would leave text columns with JSON-quoted values.
  SELECT string_agg(
    format('%I = (jsonb_populate_record(NULL::%I, $1)).%I', f, p_table_name, f),
    ', '
  )
  INTO v_update_set
  FROM unnest(p_fields) AS f
  WHERE f NOT IN ('id', 'tenant_id', 'created_at')
    AND f <> v_pk_col;

  -- Execute update
  IF v_update_set IS NOT NULL AND v_update_set != '' THEN
    EXECUTE format(
      'UPDATE %I SET %s%s WHERE %I = $2 AND tenant_id = $3',
      p_table_name,
      v_update_set,
      CASE WHEN v_has_updated_at THEN ', updated_at = now()' ELSE '' END,
      v_pk_col
    ) USING v_new_record, p_record_id, p_tenant_id;
  END IF;

  -- Get final record state
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE %I = $1 AND tenant_id = $2',
    p_table_name, v_pk_col
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
$function$;

-- ── copy_fields_between_records ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.copy_fields_between_records(
  p_tenant_id        UUID,
  p_table_name       TEXT,
  p_source_record_id UUID,
  p_target_record_id UUID,
  p_fields           TEXT[],
  p_copied_by        TEXT,
  p_change_source    TEXT DEFAULT 'local'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $function$
DECLARE
  v_source_record JSONB;
  v_target_record JSONB;
  v_new_target JSONB;
  v_field TEXT;
  v_previous_values JSONB := '{}';
  v_update_set TEXT := '';
  v_change_summary TEXT;
  v_pk_col TEXT;
  v_has_updated_at BOOLEAN;
BEGIN
  -- Same PK lookup as restore_fields_from_version above.
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
    -- See restore_fields_from_version: PK lookup failure = schema drift,
    -- not a missing source record.
    RAISE EXCEPTION 'No primary key found for table % — schema/whitelist drift', p_table_name;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_table_name
      AND column_name = 'updated_at'
  ) INTO v_has_updated_at;

  -- Get source record (including deleted)
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE %I = $1 AND tenant_id = $2',
    p_table_name, v_pk_col
  ) INTO v_source_record USING p_source_record_id, p_tenant_id;

  IF v_source_record IS NULL THEN
    RAISE EXCEPTION 'Source record not found';
  END IF;

  -- Get target record (must not be deleted)
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE %I = $1 AND tenant_id = $2 AND (is_deleted = false OR is_deleted IS NULL)',
    p_table_name, v_pk_col
  ) INTO v_target_record USING p_target_record_id, p_tenant_id;

  IF v_target_record IS NULL THEN
    RAISE EXCEPTION 'Target record not found or is deleted';
  END IF;

  -- Build changes
  v_new_target := v_target_record;

  FOREACH v_field IN ARRAY p_fields LOOP
    IF v_field IN ('id', 'tenant_id', 'created_at') OR v_field = v_pk_col THEN
      CONTINUE;
    END IF;

    v_previous_values := v_previous_values || jsonb_build_object(v_field, v_target_record->v_field);
    v_new_target := jsonb_set(v_new_target, ARRAY[v_field], COALESCE(v_source_record->v_field, 'null'::jsonb));
  END LOOP;

  -- Build UPDATE (jsonb_populate_record: type-correct decode, see the
  -- restore_fields_from_version note above).
  SELECT string_agg(
    format('%I = (jsonb_populate_record(NULL::%I, $1)).%I', f, p_table_name, f),
    ', '
  )
  INTO v_update_set
  FROM unnest(p_fields) AS f
  WHERE f NOT IN ('id', 'tenant_id', 'created_at')
    AND f <> v_pk_col;

  -- Execute update
  IF v_update_set IS NOT NULL AND v_update_set != '' THEN
    EXECUTE format(
      'UPDATE %I SET %s%s WHERE %I = $2 AND tenant_id = $3',
      p_table_name,
      v_update_set,
      CASE WHEN v_has_updated_at THEN ', updated_at = now()' ELSE '' END,
      v_pk_col
    ) USING v_new_target, p_target_record_id, p_tenant_id;
  END IF;

  -- Get final state
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE %I = $1 AND tenant_id = $2',
    p_table_name, v_pk_col
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
$function$;

