-- end_voice_session re-captures customer_context at CALL END, not just at start.
--
-- THE BUG (Dale, 2026-07-21): a call whose outcome is "Booked" showed
-- "Appointment History · Total: 0" and "0 appointments". The customer_context
-- column is a SNAPSHOT written by start_voice_session() at the instant the call
-- CONNECTS — i.e. the caller's history BEFORE they do anything. On a first
-- booking that is always 0, so "Booked / 0 appointments" looked broken. It also
-- made the count useless for review: you want what the call PRODUCED, not what
-- the caller had before dialing. (Verified: the 7:34 PM Neil call froze total=0
-- and then booked TWO appointments during the call, so the NEXT call's start
-- snapshot read 2 — the 0→2 jump was the double-booking, one call two rows.)
--
-- FIX: after the finalize UPDATE, recompute the context from the customer's
-- CURRENT state (which now includes anything booked during the call) and store
-- it. The agent already used the start-of-call context LIVE during the call, so
-- overwriting the stored copy costs the agent nothing; only the dashboard reads
-- it afterward, and it should read the post-call truth.
--
-- Only fires when the call has a customer_id (someone was identified). A call
-- that never identified a caller keeps its start snapshot — there is no customer
-- whose post-call state to read. is_known_customer becomes true here iff the
-- customer now exists, which by call end they do — correct.

CREATE OR REPLACE FUNCTION public.end_voice_session(
    p_tenant_id uuid,
    p_call_id text,
    p_duration_seconds integer DEFAULT NULL::integer,
    p_outcome text DEFAULT NULL::text,
    p_transcript text DEFAULT NULL::text,
    p_summary text DEFAULT NULL::text,
    p_appointment_id uuid DEFAULT NULL::uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_found boolean;
BEGIN
    UPDATE voice_sessions
    SET
        status = 'completed',
        ended_at = now(),
        duration_seconds = COALESCE(p_duration_seconds, EXTRACT(EPOCH FROM (now() - started_at))::INTEGER),
        outcome = p_outcome,
        transcript = p_transcript,
        summary = p_summary,
        appointment_id = p_appointment_id,
        updated_at = now()
    WHERE tenant_id = p_tenant_id AND call_id = p_call_id;

    v_found := FOUND;

    -- Re-capture the context to reflect actions taken DURING the call (a booking
    -- just made, a cancellation). Recomputed from the customer's phone via the
    -- same function the dashboard/agent use, so the stored snapshot matches a
    -- live read taken the instant the call ended.
    UPDATE voice_sessions vs
    SET customer_context = get_customer_context_for_call(p_tenant_id, c.phone)
    FROM customers c
    WHERE vs.tenant_id = p_tenant_id
      AND vs.call_id = p_call_id
      AND vs.customer_id = c.customer_id;

    RETURN v_found;
END;
$function$;
