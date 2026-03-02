-- Migration to allow updating appointments and associated customer info atomically (v2 with notes)

CREATE OR REPLACE FUNCTION update_appointment_customer(
    p_appointment_id UUID,
    p_tenant_id UUID,
    -- Appointment fields
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_description TEXT,
    p_location TEXT,
    -- Customer fields (to be updated on the linked customer)
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_customer_notes TEXT -- New parameter for notes
) RETURNS TABLE (
    success BOOLEAN,
    error_message TEXT
) AS $$
DECLARE
    v_customer_id UUID;
    v_resource_id UUID;
    v_overlap_exists BOOLEAN;
BEGIN
    -- 1. Get current IDs and verify tenant ownership
    SELECT customer_id, resource_id INTO v_customer_id, v_resource_id
    FROM appointments
    WHERE id = p_appointment_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Appointment not found or access denied (ID: ' || p_appointment_id || ', Tenant: ' || p_tenant_id || ')'::TEXT;
        RETURN;
    END IF;

    -- 2. Check for overlapping appointments (excluding the current one)
    SELECT EXISTS (
        SELECT 1 FROM appointments
        WHERE resource_id = v_resource_id
        AND id <> p_appointment_id
        AND status = 'scheduled'
        AND start_time < p_end_time
        AND end_time > p_start_time
    ) INTO v_overlap_exists;

    IF v_overlap_exists THEN
        RETURN QUERY SELECT FALSE, 'New time slot overlaps with another appointment'::TEXT;
        RETURN;
    END IF;

    -- 3. Update Appointment
    UPDATE appointments
    SET 
        start_time = p_start_time,
        end_time = p_end_time,
        description = p_description,
        location = p_location
    WHERE id = p_appointment_id;

    -- 4. Update Customer Metadata (atomic JSON merge for notes)
    UPDATE customers
    SET 
        name = p_customer_name,
        phone = p_customer_phone,
        metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{notes}', to_jsonb(p_customer_notes))
    WHERE id = v_customer_id AND tenant_id = p_tenant_id;

    RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;
