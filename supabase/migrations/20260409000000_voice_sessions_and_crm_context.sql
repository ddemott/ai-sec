-- Voice Sessions: Track active and completed voice calls with CRM context
-- This enables showing customer information when calls are answered

CREATE TABLE IF NOT EXISTS voice_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    call_id TEXT NOT NULL,  -- Vapi call ID
    caller_phone TEXT NOT NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

    -- Customer context snapshot (captured at call start)
    customer_context JSONB DEFAULT '{}',

    -- Call state
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'transferred')),
    started_at TIMESTAMPTZ DEFAULT now(),
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,

    -- Conversation data
    transcript TEXT,
    summary TEXT,

    -- Outcome tracking
    outcome TEXT,  -- 'appointment_booked', 'info_provided', 'transferred', 'voicemail', etc.
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,

    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE(tenant_id, call_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_voice_sessions_tenant_id ON voice_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_customer_id ON voice_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_caller_phone ON voice_sessions(caller_phone);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_status ON voice_sessions(status);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_started_at ON voice_sessions(started_at DESC);

-- Add customer_id to link leads to customers (if leads table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads') THEN
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS voice_session_id UUID REFERENCES voice_sessions(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_leads_customer_id ON leads(customer_id);
    END IF;
END $$;

-- Add notes array to customers metadata if not already present
-- (customers.metadata JSONB already exists from initial schema)
COMMENT ON COLUMN customers.metadata IS 'Customer metadata including notes array, preferences, tags, etc.';

-- RLS Policies for voice_sessions
ALTER TABLE voice_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY voice_sessions_tenant_isolation ON voice_sessions
    FOR ALL
    USING (tenant_id::text = current_setting('app.current_tenant_id', true));

-- Function to get customer context for voice calls
CREATE OR REPLACE FUNCTION get_customer_context_for_call(
    p_tenant_id UUID,
    p_phone TEXT
) RETURNS JSONB AS $$
DECLARE
    v_customer RECORD;
    v_context JSONB;
    v_appointments JSONB;
    v_stats RECORD;
BEGIN
    -- Normalize phone number for lookup (strip non-digits for comparison)
    SELECT * INTO v_customer
    FROM customers
    WHERE tenant_id = p_tenant_id
    AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g')
    AND is_deleted = false
    LIMIT 1;

    IF v_customer IS NULL THEN
        -- Unknown caller
        RETURN jsonb_build_object(
            'is_known_customer', false,
            'customer', null,
            'appointment_history', jsonb_build_object(
                'total', 0,
                'completed', 0,
                'cancelled', 0,
                'last_appointment', null,
                'upcoming_appointments', '[]'::jsonb
            ),
            'notes', '[]'::jsonb,
            'preferences', '{}'::jsonb,
            'tags', '[]'::jsonb
        );
    END IF;

    -- Get appointment statistics
    SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'canceled') as cancelled
    INTO v_stats
    FROM appointments
    WHERE customer_id = v_customer.id
    AND tenant_id = p_tenant_id;

    -- Get upcoming appointments
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'start_time', a.start_time,
            'end_time', a.end_time,
            'status', a.status,
            'description', a.description,
            'resource_name', r.name,
            'employee_name', e.name
        ) ORDER BY a.start_time
    ), '[]'::jsonb) INTO v_appointments
    FROM appointments a
    LEFT JOIN resources r ON r.id = a.resource_id
    LEFT JOIN employees e ON e.id = a.employee_id
    WHERE a.customer_id = v_customer.id
    AND a.tenant_id = p_tenant_id
    AND a.start_time > now()
    AND a.status = 'scheduled'
    LIMIT 5;

    -- Build context
    v_context := jsonb_build_object(
        'is_known_customer', true,
        'customer', jsonb_build_object(
            'id', v_customer.id,
            'name', v_customer.name,
            'phone', v_customer.phone,
            'email', v_customer.email,
            'address', v_customer.address,
            'created_at', v_customer.created_at
        ),
        'appointment_history', jsonb_build_object(
            'total', COALESCE(v_stats.total, 0),
            'completed', COALESCE(v_stats.completed, 0),
            'cancelled', COALESCE(v_stats.cancelled, 0),
            'upcoming_appointments', v_appointments
        ),
        'notes', COALESCE(v_customer.metadata->'notes', '[]'::jsonb),
        'preferences', COALESCE(v_customer.metadata->'preferences', '{}'::jsonb),
        'tags', COALESCE(v_customer.metadata->'tags', '[]'::jsonb),
        'member_since', v_customer.created_at
    );

    RETURN v_context;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to start a voice session with CRM context
CREATE OR REPLACE FUNCTION start_voice_session(
    p_tenant_id UUID,
    p_call_id TEXT,
    p_caller_phone TEXT
) RETURNS JSONB AS $$
DECLARE
    v_context JSONB;
    v_customer_id UUID;
    v_session_id UUID;
BEGIN
    -- Get customer context
    v_context := get_customer_context_for_call(p_tenant_id, p_caller_phone);

    -- Extract customer_id if known
    IF (v_context->>'is_known_customer')::boolean THEN
        v_customer_id := (v_context->'customer'->>'id')::UUID;
    END IF;

    -- Create voice session
    INSERT INTO voice_sessions (
        tenant_id, call_id, caller_phone, customer_id, customer_context, status
    ) VALUES (
        p_tenant_id, p_call_id, p_caller_phone, v_customer_id, v_context, 'active'
    )
    ON CONFLICT (tenant_id, call_id) DO UPDATE SET
        customer_context = EXCLUDED.customer_context,
        updated_at = now()
    RETURNING id INTO v_session_id;

    -- Return context with session ID
    RETURN v_context || jsonb_build_object('session_id', v_session_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to end a voice session
CREATE OR REPLACE FUNCTION end_voice_session(
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
        status = 'completed',
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

-- Function to add a note to a customer
CREATE OR REPLACE FUNCTION add_customer_note(
    p_customer_id UUID,
    p_note TEXT,
    p_note_type TEXT DEFAULT 'general',
    p_call_id TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    v_note JSONB;
BEGIN
    v_note := jsonb_build_object(
        'id', gen_random_uuid(),
        'text', p_note,
        'type', p_note_type,
        'call_id', p_call_id,
        'created_at', now()
    );

    UPDATE customers
    SET metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{notes}',
        COALESCE(metadata->'notes', '[]'::jsonb) || v_note
    ),
    updated_at = now()
    WHERE id = p_customer_id;

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
