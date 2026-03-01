-- Add location to appointments for mobile services
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS location TEXT;

-- Update the book_appointment_atomic function to handle location
CREATE OR REPLACE FUNCTION book_appointment_atomic(
    p_tenant_id UUID,
    p_resource_id UUID,
    p_customer_id UUID,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_description TEXT,
    p_call_id TEXT,
    p_location TEXT DEFAULT NULL -- New parameter
) RETURNS TABLE (
    success BOOLEAN,
    appointment_id UUID,
    error_message TEXT
) AS $$
DECLARE
    v_overlap_exists BOOLEAN;
    v_new_appointment_id UUID;
BEGIN
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
        INSERT INTO appointments (
            tenant_id, resource_id, customer_id, start_time, end_time, description, call_id, location
        ) VALUES (
            p_tenant_id, p_resource_id, p_customer_id, p_start_time, p_end_time, p_description, p_call_id, p_location
        ) RETURNING id INTO v_new_appointment_id;

        RETURN QUERY SELECT TRUE, v_new_appointment_id, NULL::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;
