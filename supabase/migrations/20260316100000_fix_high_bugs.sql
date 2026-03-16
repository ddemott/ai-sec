-- Migration: Fix high-priority bugs BUG-007, BUG-008, BUG-009, BUG-027
-- BUG-008: api_user has ALL PRIVILEGES (restrict to minimum needed)
-- BUG-009: Service requirements not enforced at booking time
-- BUG-027: Customer lookup/merge missing in booking flow

-- ============================================================
-- BUG-008: Restrict api_user to minimum required privileges
-- ============================================================
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM api_user;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM api_user;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM api_user;

-- Re-grant only what's needed
GRANT USAGE ON SCHEMA public TO api_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO api_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO api_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO api_user;

-- Ensure future tables/sequences also get the right grants
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO api_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO api_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO api_user;

-- ============================================================
-- BUG-009: Add optional service_id to book_appointment_atomic
-- Validates resource capabilities and employee skills against service requirements
-- BUG-027: Add optional phone/name for customer upsert
-- ============================================================
-- Drop old 9-param version to avoid overload ambiguity
DROP FUNCTION IF EXISTS book_appointment_atomic(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION book_appointment_atomic(
    p_tenant_id UUID,
    p_resource_id UUID,
    p_customer_id UUID,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_description TEXT,
    p_call_id TEXT,
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
BEGIN
    -- 0. Get tenant timezone (default to UTC if not set)
    SELECT COALESCE(t.timezone, 'UTC') INTO v_tenant_tz
    FROM tenants t WHERE t.id = p_tenant_id;

    IF v_tenant_tz IS NULL THEN
        v_tenant_tz := 'UTC';
    END IF;

    -- 0b. BUG-027: Customer upsert if phone provided but no customer_id
    IF p_customer_id IS NULL AND p_customer_phone IS NOT NULL THEN
        -- Try to find existing customer by phone
        SELECT id INTO v_actual_customer_id
        FROM customers
        WHERE tenant_id = p_tenant_id AND phone = p_customer_phone
        LIMIT 1;

        -- Create if not found
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

    -- 1. Parse p_assignment_id
    IF p_assignment_id IS NOT NULL AND p_assignment_id <> '' THEN
        IF is_uuid(p_assignment_id) THEN
            v_user_id := p_assignment_id::UUID;
        ELSE
            v_employee_id := p_assignment_id::INTEGER;
        END IF;
    END IF;

    -- 1b. BUG-009: Validate service requirements if service_id provided
    IF p_service_id IS NOT NULL THEN
        SELECT s.required_skills, s.required_resources
        INTO v_required_skills, v_required_resources
        FROM services s
        WHERE s.id = p_service_id AND s.tenant_id = p_tenant_id;

        -- Check resource capabilities against service requirements
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

        -- Check employee skills against service requirements
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

        -- B. Shift Check (uses tenant timezone)
        IF NOT EXISTS (
            SELECT 1 FROM employee_shifts
            WHERE employee_id = v_employee_id
              AND day_of_week = EXTRACT(DOW FROM p_start_time AT TIME ZONE v_tenant_tz)::INTEGER
              AND start_time <= (p_start_time AT TIME ZONE v_tenant_tz)::TIME
              AND end_time >= (p_end_time AT TIME ZONE v_tenant_tz)::TIME
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
        p_tenant_id, p_resource_id, v_actual_customer_id, p_start_time, p_end_time, p_description, p_call_id, p_location, v_employee_id, v_user_id
    ) RETURNING id INTO v_new_appointment_id;

    RETURN QUERY SELECT TRUE, v_new_appointment_id, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;
