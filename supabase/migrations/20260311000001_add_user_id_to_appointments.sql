-- Migration to add assigned_to_user_id to appointments and update RPCs

-- 1. Add assigned_to_user_id column
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_assigned_to_user_id ON appointments(assigned_to_user_id);

-- 2. Helper function to determine if a string is a valid UUID
CREATE OR REPLACE FUNCTION is_uuid(p_val TEXT) RETURNS BOOLEAN AS $$
BEGIN
    RETURN p_val ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- 3. Update update_appointment_customer to handle polymorphic employee/user assignment
CREATE OR REPLACE FUNCTION update_appointment_customer(
    p_appointment_id UUID,
    p_tenant_id UUID,
    -- Appointment fields
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_description TEXT,
    p_location TEXT,
    p_resource_id UUID,
    p_assignment_id TEXT, -- Polymorphic ID (integer string for employee, UUID for user)
    -- Customer fields
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

    -- 2. Verify tenant ownership
    SELECT customer_id INTO v_customer_id
    FROM appointments
    WHERE id = p_appointment_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Appointment not found or access denied'::TEXT;
        RETURN;
    END IF;

    -- 3. Resource Overlap Check
    SELECT EXISTS (
        SELECT 1 FROM appointments
        WHERE resource_id = p_resource_id
        AND id <> p_appointment_id
        AND status = 'scheduled'
        AND start_time < p_end_time
        AND end_time > p_start_time
    ) INTO v_overlap_exists;

    IF v_overlap_exists THEN
        RETURN QUERY SELECT FALSE, 'Resource slot already booked'::TEXT;
        RETURN;
    END IF;

    -- 4. Employee Overlap Check
    IF v_employee_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM appointments
            WHERE employee_id = v_employee_id
            AND id <> p_appointment_id
            AND status = 'scheduled'
            AND start_time < p_end_time
            AND end_time > p_start_time
        ) INTO v_overlap_exists;

        IF v_overlap_exists THEN
            RETURN QUERY SELECT FALSE, 'Employee already booked'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- 5. User Overlap Check
    IF v_user_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM appointments
            WHERE assigned_to_user_id = v_user_id
            AND id <> p_appointment_id
            AND status = 'scheduled'
            AND start_time < p_end_time
            AND end_time > p_start_time
        ) INTO v_overlap_exists;

        IF v_overlap_exists THEN
            RETURN QUERY SELECT FALSE, 'Staff member (user) already booked'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- 6. Update Appointment
    UPDATE appointments
    SET 
        start_time = p_start_time,
        end_time = p_end_time,
        description = p_description,
        location = p_location,
        resource_id = p_resource_id,
        employee_id = v_employee_id,
        assigned_to_user_id = v_user_id
    WHERE id = p_appointment_id;

    -- 7. Update Customer
    UPDATE customers
    SET 
            name = p_customer_name,
            phone = p_customer_phone,
            metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{notes}', to_jsonb(p_customer_notes))
    WHERE id = v_customer_id AND tenant_id = p_tenant_id;

    RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- 4. Update book_appointment_atomic to handle polymorphic assignment
-- Drop old signatures to avoid "not unique" errors
DROP FUNCTION IF EXISTS book_appointment_atomic(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT);
DROP FUNCTION IF EXISTS book_appointment_atomic(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS book_appointment_atomic(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INTEGER);

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
    -- Parse p_assignment_id
    IF p_assignment_id IS NOT NULL AND p_assignment_id <> '' THEN
        IF is_uuid(p_assignment_id) THEN
            v_user_id := p_assignment_id::UUID;
        ELSE
            v_employee_id := p_assignment_id::INTEGER;
        END IF;
    END IF;

    -- Resource Overlap Check
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

    -- Employee/User Overlap Check
    IF v_employee_id IS NOT NULL THEN
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

    -- Insert
    INSERT INTO appointments (
        tenant_id, resource_id, customer_id, start_time, end_time, description, call_id, location, employee_id, assigned_to_user_id
    ) VALUES (
        p_tenant_id, p_resource_id, p_customer_id, p_start_time, p_end_time, p_description, p_call_id, p_location, v_employee_id, v_user_id
    ) RETURNING id INTO v_new_appointment_id;

    RETURN QUERY SELECT TRUE, v_new_appointment_id, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;
