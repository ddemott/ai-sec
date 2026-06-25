-- reap_stale_voice_sessions(): server-side backstop that guarantees every call
-- has a finalized record even if the LiveKit agent never sends voice-session-end.
--
-- Why: a voice_sessions row is created at call START (keyed by call_id, null
-- caller_phone accepted). The agent is supposed to finalize it on hang-up via
-- end_voice_session, but that write can be missed (worker stays alive between
-- jobs, so the job-shutdown callback never runs; abrupt teardown; network).
-- When it's missed the row sits status='active' forever with no duration — the
-- call effectively "doesn't show". Per the durability rule (a record must exist
-- from the start regardless of name/phone/agent behaviour), this function force-
-- finalizes any row left 'active' past p_max_age_minutes, computing duration from
-- started_at. The agent still supplies transcript/summary/outcome when it can;
-- this only guarantees the row never stays open.
--
-- SECURITY DEFINER so the cross-tenant maintenance worker bypasses RLS (mirrors
-- fn_audit_trigger). Idempotent: only touches rows still 'active'. Returns the
-- number of rows reaped so the worker can log/alert on a nonzero count.
CREATE OR REPLACE FUNCTION reap_stale_voice_sessions(p_max_age_minutes INTEGER DEFAULT 15)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
    -- Clamp to >= 1 minute. p_max_age_minutes reaches a SECURITY DEFINER
    -- function; a 0 or negative value would push the cutoff into the future and
    -- finalize LIVE, in-progress calls. Never reap anything younger than a minute.
    v_min_age INTEGER := GREATEST(COALESCE(p_max_age_minutes, 15), 1);
BEGIN
    UPDATE voice_sessions
    SET
        status = 'completed',
        ended_at = now(),
        duration_seconds = COALESCE(
            duration_seconds,
            EXTRACT(EPOCH FROM (now() - started_at))::INTEGER
        ),
        -- Human-visible marker so the Calls tab explains WHY this row has no
        -- transcript/outcome: the agent never sent its end. Only set when blank.
        summary = COALESCE(
            NULLIF(summary, ''),
            'Auto-finalized: the call ended but the agent did not send a completion record.'
        ),
        updated_at = now()
    WHERE status = 'active'
      AND started_at < now() - make_interval(mins => v_min_age);

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
-- search_path pinned: a SECURITY DEFINER function with a mutable search_path can
-- be hijacked (an attacker-created object shadowing an unqualified name would run
-- with the definer's rights). pg_catalog first so built-ins can't be shadowed.
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

-- Don't leave this cross-tenant maintenance RPC executable by untrusted roles.
-- REVOKE FROM PUBLIC drops the default grant; but Supabase ALTER DEFAULT
-- PRIVILEGES also auto-grants EXECUTE to anon/authenticated (the roles PostgREST
-- exposes), so revoke those explicitly too. Guarded by role existence so this is
-- a no-op on local/CI Postgres (which has no anon/authenticated). The function's
-- owning role (which the app connects as) keeps EXECUTE as owner regardless.
REVOKE ALL ON FUNCTION reap_stale_voice_sessions(INTEGER) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION reap_stale_voice_sessions(INTEGER) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION reap_stale_voice_sessions(INTEGER) FROM authenticated';
  END IF;
END $$;
