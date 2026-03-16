-- Migration: Fix low-priority bugs
-- BUG-040: Auto-calculate end_time from service duration_minutes
-- BUG-041: Seed idempotency (fixed in seed.sql directly)
-- BUG-052: JSONB metadata CHECK constraint

-- ============================================================
-- BUG-040: Auto-calculate end_time from service.duration_minutes
-- When p_end_time is NULL and p_service_id is provided, derive
-- end_time = start_time + service.duration_minutes
-- ============================================================
DROP FUNCTION IF EXISTS book_appointment_atomic(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT);
CREATE OR REPLACE FUNCTION book_appointment_atomic(
    p_tenant_id UUID,
    p_resource_id UUID,
    p_customer_id UUID,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_call_id TEXT DEFAULT NULL,
    p_location TEXT DEFAULT NULL,
    p_assignment_id TEXT DEFAULT NULL,
    p_service_id INTEGER DEFAULT NULL,
    p_customer_phone TEXT DEFAULT NULL,
    p_customer_name TEXT DEFAULT NULL
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
    v_tenant_tz TEXT;
    v_actual_customer_id UUID;
    v_required_skills TEXT[];
    v_required_resources TEXT[];
    v_resource_caps TEXT[];
    v_employee_skills TEXT[];
    v_start_local TIMESTAMP;
    v_end_local TIMESTAMP;
    v_effective_end TIMESTAMPTZ;
    v_service_duration INTEGER;
BEGIN
    -- 0. Get tenant timezone (default to UTC if not set)
    SELECT COALESCE(t.timezone, 'UTC') INTO v_tenant_tz
    FROM tenants t WHERE t.id = p_tenant_id;

    IF v_tenant_tz IS NULL THEN
        v_tenant_tz := 'UTC';
    END IF;

    -- BUG-040: Auto-calculate end_time from service duration if not provided
    IF p_end_time IS NULL AND p_service_id IS NOT NULL THEN
        SELECT s.duration_minutes INTO v_service_duration
        FROM services s WHERE s.id = p_service_id AND s.tenant_id = p_tenant_id;

        IF v_service_duration IS NOT NULL THEN
            v_effective_end := p_start_time + (v_service_duration || ' minutes')::INTERVAL;
        ELSE
            RETURN QUERY SELECT FALSE, NULL::UUID,
                'Cannot calculate end_time: service not found or has no duration'::TEXT;
            RETURN;
        END IF;
    ELSIF p_end_time IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::UUID,
            'end_time is required when no service_id is provided'::TEXT;
        RETURN;
    ELSE
        v_effective_end := p_end_time;
    END IF;

    -- 0b. BUG-027: Customer upsert if phone provided but no customer_id
    IF p_customer_id IS NULL AND p_customer_phone IS NOT NULL THEN
        SELECT id INTO v_actual_customer_id
        FROM customers
        WHERE tenant_id = p_tenant_id AND phone = p_customer_phone
        LIMIT 1;

        IF v_actual_customer_id IS NULL THEN
            INSERT INTO customers (tenant_id, phone, name)
            VALUES (p_tenant_id, p_customer_phone, COALESCE(p_customer_name, 'Unknown'))
            RETURNING id INTO v_actual_customer_id;
        END IF;
    ELSE
        v_actual_customer_id := p_customer_id;
    END IF;

    IF v_actual_customer_id IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, 'Customer ID or phone number is required'::TEXT;
        RETURN;
    END IF;

    -- 1. Parse p_assignment_id (BUG-014: error on malformed input)
    IF p_assignment_id IS NOT NULL AND p_assignment_id <> '' THEN
        IF is_uuid(p_assignment_id) THEN
            v_user_id := p_assignment_id::UUID;
        ELSIF p_assignment_id ~ '^\d+$' THEN
            v_employee_id := p_assignment_id::INTEGER;
        ELSE
            RETURN QUERY SELECT FALSE, NULL::UUID,
                ('Invalid assignment_id format: must be a UUID or integer, got "' || p_assignment_id || '"')::TEXT;
            RETURN;
        END IF;
    END IF;

    -- 1b. BUG-009: Validate service requirements if service_id provided
    IF p_service_id IS NOT NULL THEN
        SELECT s.required_skills, s.required_resources
        INTO v_required_skills, v_required_resources
        FROM services s
        WHERE s.id = p_service_id AND s.tenant_id = p_tenant_id;

        IF v_required_resources IS NOT NULL AND array_length(v_required_resources, 1) > 0 THEN
            SELECT COALESCE(r.capabilities, '{}')
            INTO v_resource_caps
            FROM resources r
            WHERE r.id = p_resource_id;

            IF NOT v_required_resources <@ v_resource_caps THEN
                RETURN QUERY SELECT FALSE, NULL::UUID,
                    'Resource does not have required capabilities for this service'::TEXT;
                RETURN;
            END IF;
        END IF;

        IF v_employee_id IS NOT NULL AND v_required_skills IS NOT NULL AND array_length(v_required_skills, 1) > 0 THEN
            SELECT COALESCE(e.skills, '{}')
            INTO v_employee_skills
            FROM employees e
            WHERE e.id = v_employee_id AND e.tenant_id = p_tenant_id;

            IF NOT v_required_skills <@ v_employee_skills THEN
                RETURN QUERY SELECT FALSE, NULL::UUID,
                    'Employee does not have required skills for this service'::TEXT;
                RETURN;
            END IF;
        END IF;
    END IF;

    -- 2. Resource Overlap Check
    SELECT EXISTS (
        SELECT 1 FROM appointments
        WHERE resource_id = p_resource_id
        AND status = 'scheduled'
        AND start_time < v_effective_end
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
            AND start_time < v_effective_end
            AND end_time > p_start_time
        ) INTO v_overlap_exists;

        IF v_overlap_exists THEN
            RETURN QUERY SELECT FALSE, NULL::UUID, 'Employee already booked'::TEXT;
            RETURN;
        END IF;

        -- B. BUG-046: DST-safe shift check
        v_start_local := p_start_time AT TIME ZONE v_tenant_tz;
        v_end_local := v_effective_end AT TIME ZONE v_tenant_tz;

        IF NOT EXISTS (
            SELECT 1 FROM employee_shifts
            WHERE employee_id = v_employee_id
              AND day_of_week = EXTRACT(DOW FROM v_start_local)::INTEGER
              AND start_time <= v_start_local::TIME
              AND end_time >= v_end_local::TIME
              AND is_active = true
        ) THEN
            IF EXTRACT(DOW FROM v_start_local) <> EXTRACT(DOW FROM v_end_local) THEN
                RETURN QUERY SELECT FALSE, NULL::UUID, 'Appointment spans multiple days and cannot be validated against shifts'::TEXT;
                RETURN;
            END IF;
            RETURN QUERY SELECT FALSE, NULL::UUID, 'Employee is not on shift during this time'::TEXT;
            RETURN;
        END IF;

    ELSIF v_user_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM appointments
            WHERE assigned_to_user_id = v_user_id
            AND status = 'scheduled'
            AND start_time < v_effective_end
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
        p_tenant_id, p_resource_id, v_actual_customer_id, p_start_time, v_effective_end, p_description, p_call_id, p_location, v_employee_id, v_user_id
    ) RETURNING id INTO v_new_appointment_id;

    RETURN QUERY SELECT TRUE, v_new_appointment_id, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- BUG-052: Add CHECK constraint for JSONB metadata fields
-- Ensures metadata is always a JSON object (not array/scalar)
-- ============================================================
DO $$
BEGIN
    -- customers.metadata must be a JSON object when present
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'customers_metadata_is_object'
    ) THEN
        ALTER TABLE customers ADD CONSTRAINT customers_metadata_is_object
            CHECK (metadata IS NULL OR jsonb_typeof(metadata) = 'object');
    END IF;

    -- appointments.metadata must be a JSON object when present
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'appointments_metadata_is_object'
    ) THEN
        ALTER TABLE appointments ADD CONSTRAINT appointments_metadata_is_object
            CHECK (metadata IS NULL OR jsonb_typeof(metadata) = 'object');
    END IF;
END $$;
