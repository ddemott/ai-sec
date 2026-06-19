-- Make end_voice_session set status='transferred' when outcome='transferred'.
--
-- Background: voice_sessions.status already supports 'transferred' (since the
-- original voice_sessions table + check constraint). The transfer_call tool
-- already calls outcome.recordTransfer() which sets tracked outcome='transferred',
-- and the shutdown sends it to /agent-tools/voice-session-end (which calls this
-- RPC).
--
-- Previously the RPC always forced status='completed' even for transfers, so
-- transferred calls never appeared with the correct status in the Calls tab
-- (even though the tab + filters + badges already supported 'transferred').
--
-- This change makes the status reflect reality for cold-transferred calls.
-- Other outcomes continue to mark the session 'completed' (or whatever the
-- caller passes; the RPC only special-cases transferred for status).

BEGIN;

CREATE OR REPLACE FUNCTION public.end_voice_session(
    p_tenant_id UUID,
    p_call_id TEXT,
    p_duration_seconds INTEGER DEFAULT NULL,
    p_outcome TEXT DEFAULT NULL,
    p_transcript TEXT DEFAULT NULL,
    p_summary TEXT DEFAULT NULL,
    p_appointment_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE voice_sessions
    SET
        status = CASE WHEN p_outcome = 'transferred' THEN 'transferred' ELSE 'completed' END,
        ended_at = now(),
        duration_seconds = COALESCE(p_duration_seconds, EXTRACT(EPOCH FROM (now() - started_at))::INTEGER),
        outcome = p_outcome,
        transcript = p_transcript,
        summary = p_summary,
        appointment_id = p_appointment_id,
        updated_at = now()
    WHERE tenant_id = p_tenant_id AND call_id = p_call_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.end_voice_session(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, UUID)
IS 'Ends a voice session. Sets status=transferred (instead of completed) when outcome=transferred so the Calls tab can distinguish live hand-offs.';

COMMIT;
