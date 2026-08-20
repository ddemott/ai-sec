-- Pilot #8 of the PK naming convention conversion (per CODING_STANDARDS.md).
-- Renames users.id → user_id.
--
-- 3 inbound FKs: appointments.assigned_to_user_id, user_feedback.user_id,
-- password_resets.user_id. All three already use `user_id` as the FK
-- column name, so the rename closes the asymmetry: now `users.user_id =
-- user_feedback.user_id` and `appointments.assigned_to_user_id` still
-- maps via explicit ON (role-based FK).
--
-- 1 RPC references users.id: book_appointment_atomic uses
-- `FROM users WHERE id = p_assignment_id::UUID` to check if a
-- polymorphic assignment_id matches a user vs an employee. CREATE
-- OR REPLACE FUNCTION suffices — RETURNS TABLE shape is unchanged.
-- Body otherwise identical to the prior definition; only the one
-- WHERE clause column reference changes.

ALTER TABLE users RENAME COLUMN id TO user_id;

CREATE OR REPLACE FUNCTION public.book_appointment_atomic(
    p_tenant_id uuid,
    p_resource_id uuid,
    p_customer_id uuid DEFAULT NULL::uuid,
    p_start_time timestamp with time zone DEFAULT NULL::timestamp with time zone,
    p_end_time timestamp with time zone DEFAULT NULL::timestamp with time zone,
    p_description text DEFAULT NULL::text,
    p_call_id text DEFAULT NULL::text,
    p_location text DEFAULT NULL::text,
    p_assignment_id text DEFAULT NULL::text,
    p_service_id uuid DEFAULT NULL::uuid,
    p_customer_phone text DEFAULT NULL::text,
    p_customer_name text DEFAULT NULL::text
)
RETURNS TABLE(success boolean, appointment_id uuid, error_message text)
LANGUAGE plpgsql
AS $function$
DECLARE
    v_overlap_exists BOOLEAN;
    v_new_appointment_id UUID;
    v_employee_id UUID := NULL;
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
    v_on_shift BOOLEAN;
    v_mapping_has_rows BOOLEAN;
BEGIN
    SELECT COALESCE(t.timezone, 'UTC') INTO v_tenant_tz
    FROM tenants t WHERE t.id = p_tenant_id;
    IF v_tenant_tz IS NULL THEN v_tenant_tz := 'UTC'; END IF;

    IF p_end_time IS NULL AND p_service_id IS NOT NULL THEN
        SELECT s.duration_minutes INTO v_service_duration
        FROM services s WHERE s.id = p_service_id AND s.tenant_id = p_tenant_id;
        IF v_service_duration IS NOT NULL THEN
            v_effective_end := p_start_time + (v_service_duration || ' minutes')::INTERVAL;
        ELSE
            RETURN QUERY SELECT FALSE, NULL::UUID, 'Cannot calculate end_time: service not found or has no duration'::TEXT;
            RETURN;
        END IF;
    ELSIF p_end_time IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, 'end_time is required when no service_id is provided'::TEXT;
        RETURN;
    ELSE
        v_effective_end := p_end_time;
    END IF;

    IF p_customer_id IS NULL AND p_customer_phone IS NOT NULL THEN
        SELECT id INTO v_actual_customer_id FROM customers
        WHERE tenant_id = p_tenant_id AND phone = p_customer_phone LIMIT 1;
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

    IF p_assignment_id IS NOT NULL AND p_assignment_id <> '' THEN
        IF NOT is_uuid(p_assignment_id) THEN
            RETURN QUERY SELECT FALSE, NULL::UUID,
                ('Invalid assignment_id format: must be a UUID, got "' || p_assignment_id || '"')::TEXT;
            RETURN;
        END IF;

        IF EXISTS (SELECT 1 FROM employees WHERE id = p_assignment_id::UUID AND tenant_id = p_tenant_id) THEN
            v_employee_id := p_assignment_id::UUID;
        ELSIF EXISTS (SELECT 1 FROM users WHERE user_id = p_assignment_id::UUID AND tenant_id = p_tenant_id) THEN
            v_user_id := p_assignment_id::UUID;
        ELSE
            RETURN QUERY SELECT FALSE, NULL::UUID,
                ('Assignment ID not found in employees or users: "' || p_assignment_id || '"')::TEXT;
            RETURN;
        END IF;
    END IF;

    -- ─── Service-driven resource + skill check ─────────────────────
    IF p_service_id IS NOT NULL THEN
        SELECT s.required_skills, s.required_resources INTO v_required_skills, v_required_resources
        FROM services s WHERE s.id = p_service_id AND s.tenant_id = p_tenant_id;

        -- Resource check: prefer service_resource mapping if populated
        SELECT EXISTS (
            SELECT 1 FROM service_resource
            WHERE service_id = p_service_id AND tenant_id = p_tenant_id
        ) INTO v_mapping_has_rows;
        IF v_mapping_has_rows THEN
            IF NOT EXISTS (
                SELECT 1 FROM service_resource
                WHERE service_id = p_service_id
                  AND resource_id = p_resource_id
                  AND tenant_id = p_tenant_id
            ) THEN
                RETURN QUERY SELECT FALSE, NULL::UUID,
                    'Resource is not assigned to perform this service'::TEXT;
                RETURN;
            END IF;
        ELSIF v_required_resources IS NOT NULL AND array_length(v_required_resources, 1) > 0 THEN
            -- Legacy fallback: capability-array check
            SELECT COALESCE(r.capabilities, '{}') INTO v_resource_caps
            FROM resources r WHERE r.id = p_resource_id;
            IF NOT v_required_resources <@ v_resource_caps THEN
                RETURN QUERY SELECT FALSE, NULL::UUID,
                    'Resource does not have required capabilities for this service'::TEXT;
                RETURN;
            END IF;
        END IF;

        -- Skill check: prefer service_employee mapping if populated
        IF v_employee_id IS NOT NULL THEN
            SELECT EXISTS (
                SELECT 1 FROM service_employee
                WHERE service_id = p_service_id AND tenant_id = p_tenant_id
            ) INTO v_mapping_has_rows;
            IF v_mapping_has_rows THEN
                IF NOT EXISTS (
                    SELECT 1 FROM service_employee
                    WHERE service_id = p_service_id
                      AND employee_id = v_employee_id
                      AND tenant_id = p_tenant_id
                ) THEN
                    RETURN QUERY SELECT FALSE, NULL::UUID,
                        'Employee is not assigned to perform this service'::TEXT;
                    RETURN;
                END IF;
            ELSIF v_required_skills IS NOT NULL AND array_length(v_required_skills, 1) > 0 THEN
                -- Legacy fallback: skill-array check
                SELECT COALESCE(e.skills, '{}') INTO v_employee_skills
                FROM employees e WHERE e.id = v_employee_id AND e.tenant_id = p_tenant_id;
                IF NOT v_required_skills <@ v_employee_skills THEN
                    RETURN QUERY SELECT FALSE, NULL::UUID,
                        'Employee does not have required skills for this service'::TEXT;
                    RETURN;
                END IF;
            END IF;
        END IF;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM appointments
        WHERE resource_id = p_resource_id AND status = 'scheduled'
          AND start_time < v_effective_end AND end_time > p_start_time
    ) INTO v_overlap_exists;
    IF v_overlap_exists THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, 'Resource already booked during this timeslot'::TEXT;
        RETURN;
    END IF;

    IF v_employee_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM appointments
            WHERE employee_id = v_employee_id AND status = 'scheduled'
              AND start_time < v_effective_end AND end_time > p_start_time
        ) INTO v_overlap_exists;
        IF v_overlap_exists THEN
            RETURN QUERY SELECT FALSE, NULL::UUID, 'Employee already booked'::TEXT;
            RETURN;
        END IF;

        v_start_local := p_start_time AT TIME ZONE v_tenant_tz;
        v_end_local := v_effective_end AT TIME ZONE v_tenant_tz;

        SELECT EXISTS (
            SELECT 1 FROM employee_schedule
            WHERE employee_id = v_employee_id
              AND tenant_id = p_tenant_id
              AND shift_date = v_start_local::DATE
              AND is_off = false
              AND start_time <= v_start_local::TIME
              AND end_time >= v_end_local::TIME
        ) INTO v_on_shift;

        IF NOT v_on_shift THEN
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
            WHERE assigned_to_user_id = v_user_id AND status = 'scheduled'
              AND start_time < v_effective_end AND end_time > p_start_time
        ) INTO v_overlap_exists;
        IF v_overlap_exists THEN
            RETURN QUERY SELECT FALSE, NULL::UUID, 'User already booked'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- Final INSERT — persists service_id when provided.
    BEGIN
        INSERT INTO appointments (
            tenant_id, resource_id, customer_id, start_time, end_time,
            description, call_id, status, location, employee_id, assigned_to_user_id,
            service_id
        ) VALUES (
            p_tenant_id, p_resource_id, v_actual_customer_id, p_start_time, v_effective_end,
            COALESCE(p_description, 'Appointment'), p_call_id, 'scheduled', p_location,
            v_employee_id, v_user_id,
            p_service_id
        ) RETURNING id INTO v_new_appointment_id;
    EXCEPTION WHEN exclusion_violation THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, 'Resource already booked during this timeslot'::TEXT;
        RETURN;
    END;

    RETURN QUERY SELECT TRUE, v_new_appointment_id, NULL::TEXT;
END;
$function$;

