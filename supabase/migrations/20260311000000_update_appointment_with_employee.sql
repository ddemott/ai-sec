-- Migration to update update_appointment_customer with employee_id and resource_id support

CREATE OR REPLACE FUNCTION update_appointment_customer(
    p_appointment_id UUID,
    p_tenant_id UUID,
    -- Appointment fields
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_description TEXT,
    p_location TEXT,
    p_resource_id UUID, -- New parameter
    p_employee_id INTEGER, -- New parameter
    -- Customer fields (to be updated on the linked customer)
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_customer_notes TEXT
) RETURNS TABLE (
    success BOOLEAN,
    error_message TEXT
) AS $$
DECLARE
    v_customer_id UUID;
    v_overlap_exists BOOLEAN;
BEGIN
    -- 1. Get current IDs and verify tenant ownership
    SELECT customer_id INTO v_customer_id
    FROM appointments
    WHERE id = p_appointment_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Appointment not found or access denied (ID: ' || p_appointment_id || ', Tenant: ' || p_tenant_id || ')'::TEXT;
        RETURN;
    END IF;

    -- 2. Check for overlapping appointments for this resource (excluding the current one)
    SELECT EXISTS (
        SELECT 1 FROM appointments
        WHERE resource_id = p_resource_id
        AND id <> p_appointment_id
        AND status = 'scheduled'
        AND start_time < p_end_time
        AND end_time > p_start_time
    ) INTO v_overlap_exists;

    IF v_overlap_exists THEN
        RETURN QUERY SELECT FALSE, 'New time slot overlaps with another appointment on this resource'::TEXT;
        RETURN;
    END IF;

    -- 3. Check for overlapping appointments for this employee (excluding the current one)
    IF p_employee_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM appointments
            WHERE employee_id = p_employee_id
            AND id <> p_appointment_id
            AND status = 'scheduled'
            AND start_time < p_end_time
            AND end_time > p_start_time
        ) INTO v_overlap_exists;

        IF v_overlap_exists THEN
            RETURN QUERY SELECT FALSE, 'New time slot overlaps with another appointment for this employee'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- 4. Update Appointment
    UPDATE appointments
    SET 
        start_time = p_start_time,
        end_time = p_end_time,
        description = p_description,
        location = p_location,
        resource_id = p_resource_id,
        employee_id = p_employee_id
    WHERE id = p_appointment_id;

    -- 5. Update Customer Metadata and Structured Name
    UPDATE customers
    SET 
            name = p_customer_name,
            first_name = NULLIF(split_part(COALESCE(p_customer_name, ''), ' ', 1), ''),
            last_name = NULLIF(
                btrim(
                    CASE
                        WHEN position(' ' IN COALESCE(p_customer_name, '')) > 0 
                        THEN substring(COALESCE(p_customer_name, '') FROM position(' ' IN COALESCE(p_customer_name, '')) + 1)
                        ELSE ''
                    END
                ),
                ''
            ),
            phone = p_customer_phone,
            metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{notes}', to_jsonb(p_customer_notes))
    WHERE id = v_customer_id AND tenant_id = p_tenant_id;

    RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;
