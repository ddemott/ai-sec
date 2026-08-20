-- Pilot #6 of the PK naming convention conversion (per CLAUDE.md).
-- Renames voice_sessions.id → voice_session_id.
--
-- Zero inbound FKs (terminal in the schema). One RPC needs recreation
-- (start_voice_session uses RETURNING id INTO v_session_id); the other
-- (end_voice_session) doesn't reference the column. No views.
--
-- Why DROP+CREATE for start_voice_session: same Postgres limitation as
-- the record_versions pilot — CREATE OR REPLACE can rename RETURNING
-- bindings without ceremony, but to keep the migration self-documenting
-- we DROP first so the next reader doesn't wonder whether a stale
-- definition is still in scope.

ALTER TABLE voice_sessions RENAME COLUMN id TO voice_session_id;

DROP FUNCTION IF EXISTS start_voice_session(uuid, text, text);

CREATE OR REPLACE FUNCTION start_voice_session(
    p_tenant_id UUID,
    p_call_id TEXT,
    p_caller_phone TEXT
) RETURNS JSONB AS $$
DECLARE
    v_context JSONB;
    v_session_id UUID;
BEGIN
    -- Get customer context first
    v_context := get_customer_context_for_call(p_tenant_id, p_caller_phone);

    -- Create voice session record
    INSERT INTO voice_sessions (
        tenant_id, call_id, caller_phone, customer_context, customer_id
    )
    VALUES (
        p_tenant_id,
        p_call_id,
        p_caller_phone,
        v_context,
        (v_context->'customer'->>'id')::UUID
    )
    RETURNING voice_session_id INTO v_session_id;

    -- Return context plus session_id
    RETURN v_context || jsonb_build_object('session_id', v_session_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

