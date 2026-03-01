-- Enable pgvector for long-term memory
CREATE EXTENSION IF NOT EXISTS vector;

-- Tenants: The business using the service
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    business_type TEXT NOT NULL, -- e.g., 'mobile-tire', 'salon', 'auto-shop'
    timezone TEXT NOT NULL DEFAULT 'UTC',
    voice_id TEXT, -- The Vapi/ElevenLabs Voice ID
    system_prompt TEXT, -- The customized AI instructions
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Resources: Things that can be booked (trucks, stylists, bays)
CREATE TABLE IF NOT EXISTS resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Customers: CRM records
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    name TEXT,
    email TEXT,
    address TEXT,
    metadata JSONB DEFAULT '{}', -- Domain-specific data (e.g., vehicle info)
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, phone)
);

-- Appointments: Internal calendar
CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled', -- 'scheduled', 'completed', 'canceled'
    description TEXT,
    metadata JSONB DEFAULT '{}',
    call_id TEXT, -- Correlation ID from Vapi
    created_at TIMESTAMPTZ DEFAULT now(),
    CHECK (end_time > start_time)
);

-- Call Summaries: Long-term contextual memory
CREATE TABLE IF NOT EXISTS call_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    embedding vector(1536), -- Vector for semantic search (OpenAI 1536 dims)
    call_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Atomic Booking Stored Procedure (RPC)
-- This ensures that we check availability and book in ONE transaction.
CREATE OR REPLACE FUNCTION book_appointment_atomic(
    p_tenant_id UUID,
    p_resource_id UUID,
    p_customer_id UUID,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_description TEXT,
    p_call_id TEXT
) RETURNS TABLE (
    success BOOLEAN,
    appointment_id UUID,
    error_message TEXT
) AS $$
DECLARE
    v_overlap_exists BOOLEAN;
    v_new_appointment_id UUID;
BEGIN
    -- 1. Check for overlapping appointments for this resource
    -- We use a simple overlap check: (StartA < EndB) AND (EndA > StartB)
    SELECT EXISTS (
        SELECT 1 FROM appointments
        WHERE resource_id = p_resource_id
        AND status = 'scheduled'
        AND start_time < p_end_time
        AND end_time > p_start_time
    ) INTO v_overlap_exists;

    IF v_overlap_exists THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, 'Slot already booked'::TEXT;
    ELSE
        -- 2. Insert the appointment
        INSERT INTO appointments (
            tenant_id, resource_id, customer_id, start_time, end_time, description, call_id
        ) VALUES (
            p_tenant_id, p_resource_id, p_customer_id, p_start_time, p_end_time, p_description, p_call_id
        ) RETURNING id INTO v_new_appointment_id;

        RETURN QUERY SELECT TRUE, v_new_appointment_id, NULL::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;
