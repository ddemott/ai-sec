-- Update book_appointment_atomic to enforce employee shifts
CREATE OR REPLACE FUNCTION book_appointment_atomic(
    p_tenant_id UUID,
    p_resource_id UUID,
    p_customer_id UUID,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_description TEXT,
    p_call_id TEXT,
    p_location TEXT DEFAULT NULL,
    p_assignment_id TEXT DEFAULT NULL -- Polymorphic ID
) RETURNS TABLE (
    success BOOLEAN,
    appointment_id UUID,
    error_message TEXT
) AS $$
DECLARE
    v_overlap_exists BOOLEAN;
    v_new_appointment_id UUID;
    v_employee_id INTEGER := NULL;
    v_user_id UUID := NULL;
BEGIN
    -- 1. Parse p_assignment_id
    IF p_assignment_id IS NOT NULL AND p_assignment_id <> '' THEN
        IF is_uuid(p_assignment_id) THEN
            v_user_id := p_assignment_id::UUID;
        ELSE
            v_employee_id := p_assignment_id::INTEGER;
        END IF;
    END IF;

    -- 2. Resource Overlap Check
    SELECT EXISTS (
        SELECT 1 FROM appointments
        WHERE resource_id = p_resource_id
        AND status = 'scheduled'
        AND start_time < p_end_time
        AND end_time > p_start_time
    ) INTO v_overlap_exists;

    IF v_overlap_exists THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, 'Resource slot already booked'::TEXT;
        RETURN;
    END IF;

    -- 3. Employee/User Logic
    IF v_employee_id IS NOT NULL THEN
        -- A. Overlap Check
        SELECT EXISTS (
            SELECT 1 FROM appointments
            WHERE employee_id = v_employee_id
            AND status = 'scheduled'
            AND start_time < p_end_time
            AND end_time > p_start_time
        ) INTO v_overlap_exists;

        IF v_overlap_exists THEN
            RETURN QUERY SELECT FALSE, NULL::UUID, 'Employee already booked'::TEXT;
            RETURN;
        END IF;

        -- B. Shift Check (NEW)
        -- We verify if the employee has ANY active shift that covers this window
        IF NOT EXISTS (
            SELECT 1 FROM employee_shifts
            WHERE employee_id = v_employee_id
              AND day_of_week = EXTRACT(DOW FROM p_start_time AT TIME ZONE 'UTC')::INTEGER
              AND start_time <= (p_start_time AT TIME ZONE 'UTC')::TIME
              AND end_time >= (p_end_time AT TIME ZONE 'UTC')::TIME
              AND is_active = true
        ) THEN
            RETURN QUERY SELECT FALSE, NULL::UUID, 'Employee is not on shift during this time'::TEXT;
            RETURN;
        END IF;

    ELSIF v_user_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM appointments
            WHERE assigned_to_user_id = v_user_id
            AND status = 'scheduled'
            AND start_time < p_end_time
            AND end_time > p_start_time
        ) INTO v_overlap_exists;

        IF v_overlap_exists THEN
            RETURN QUERY SELECT FALSE, NULL::UUID, 'Staff member (user) already booked'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- 4. Insert
    INSERT INTO appointments (
        tenant_id, resource_id, customer_id, start_time, end_time, description, call_id, location, employee_id, assigned_to_user_id
    ) VALUES (
        p_tenant_id, p_resource_id, p_customer_id, p_start_time, p_end_time, p_description, p_call_id, p_location, v_employee_id, v_user_id
    ) RETURNING id INTO v_new_appointment_id;

    RETURN QUERY SELECT TRUE, v_new_appointment_id, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;
