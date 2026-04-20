-- Rename shift_overrides → employee_schedule
-- This table IS the schedule (not an "override" of anything).
-- The old employee_shifts (weekly patterns) table is legacy and no longer used.
-- Owners schedule one day at a time and copy weeks forward.

-- 1. Rename table
ALTER TABLE IF EXISTS shift_overrides RENAME TO employee_schedule;

-- 2. Rename indexes
ALTER INDEX IF EXISTS idx_shift_overrides_employee_date RENAME TO idx_employee_schedule_employee_date;
ALTER INDEX IF EXISTS idx_shift_overrides_tenant_date RENAME TO idx_employee_schedule_tenant_date;

-- 3. Rename unique constraint (Postgres auto-names it based on table)
ALTER INDEX IF EXISTS shift_overrides_tenant_id_employee_id_shift_date_key
    RENAME TO employee_schedule_tenant_id_employee_id_shift_date_key;

-- 4. Drop and recreate RLS policies with new names
DROP POLICY IF EXISTS "Tenant isolation for shift_overrides" ON employee_schedule;
DROP POLICY IF EXISTS "Admin bypass for shift_overrides" ON employee_schedule;

CREATE POLICY "Tenant isolation for employee_schedule" ON employee_schedule
    FOR ALL USING (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::UUID);

CREATE POLICY "Admin bypass for employee_schedule" ON employee_schedule
    FOR ALL USING (
        NULLIF(current_setting('app.current_tenant_id', TRUE), '') IS NULL
    );

-- 5. Update get_effective_shifts RPC (single employee)
CREATE OR REPLACE FUNCTION get_effective_shifts(
    p_tenant_id UUID,
    p_employee_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE(
    shift_date DATE,
    day_of_week INTEGER,
    start_time TIME WITHOUT TIME ZONE,
    end_time TIME WITHOUT TIME ZONE,
    is_override BOOLEAN,
    is_off BOOLEAN,
    override_id UUID
)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    RETURN QUERY
    SELECT
        es.shift_date,
        EXTRACT(DOW FROM es.shift_date)::INTEGER AS day_of_week,
        es.start_time,
        es.end_time,
        true AS is_override,
        es.is_off,
        es.id AS override_id
    FROM employee_schedule es
    WHERE es.tenant_id = p_tenant_id
      AND es.employee_id = p_employee_id
      AND es.shift_date BETWEEN p_start_date AND p_end_date
    ORDER BY es.shift_date;
END;
$$;

-- 6. Update get_effective_shifts_bulk RPC (all employees, used by scheduler)
CREATE OR REPLACE FUNCTION get_effective_shifts_bulk(
    p_tenant_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE(
    employee_id UUID,
    shift_date DATE,
    day_of_week INTEGER,
    start_time TIME WITHOUT TIME ZONE,
    end_time TIME WITHOUT TIME ZONE,
    is_override BOOLEAN,
    is_off BOOLEAN,
    override_id UUID
)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    RETURN QUERY
    SELECT
        es.employee_id,
        es.shift_date,
        EXTRACT(DOW FROM es.shift_date)::INTEGER AS day_of_week,
        es.start_time,
        es.end_time,
        true AS is_override,
        es.is_off,
        es.id AS override_id
    FROM employee_schedule es
    WHERE es.tenant_id = p_tenant_id
      AND es.shift_date BETWEEN p_start_date AND p_end_date
    ORDER BY es.employee_id, es.shift_date;
END;
$$;

-- 7. Update book_appointment_atomic — use employee_schedule, remove employee_shifts fallback
CREATE OR REPLACE FUNCTION public.book_appointment_atomic(
    p_tenant_id uuid,
    p_resource_id uuid,
    p_customer_id uuid DEFAULT NULL,
    p_start_time timestamptz DEFAULT NULL,
    p_end_time timestamptz DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_call_id text DEFAULT NULL,
    p_location text DEFAULT NULL,
    p_assignment_id text DEFAULT NULL,
    p_service_id uuid DEFAULT NULL,
    p_customer_phone text DEFAULT NULL,
    p_customer_name text DEFAULT NULL
)
RETURNS TABLE(success boolean, appointment_id uuid, error_message text)
LANGUAGE plpgsql AS $function$
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
BEGIN
    -- 0. Get tenant timezone
    SELECT COALESCE(t.timezone, 'UTC') INTO v_tenant_tz
    FROM tenants t WHERE t.id = p_tenant_id;
    IF v_tenant_tz IS NULL THEN v_tenant_tz := 'UTC'; END IF;

    -- Auto-calculate end_time from service duration if not provided
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

    -- Customer upsert if phone provided but no customer_id
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

    -- Parse p_assignment_id
    IF p_assignment_id IS NOT NULL AND p_assignment_id <> '' THEN
        IF NOT is_uuid(p_assignment_id) THEN
            RETURN QUERY SELECT FALSE, NULL::UUID,
                ('Invalid assignment_id format: must be a UUID, got "' || p_assignment_id || '"')::TEXT;
            RETURN;
        END IF;

        IF EXISTS (SELECT 1 FROM employees WHERE id = p_assignment_id::UUID AND tenant_id = p_tenant_id) THEN
            v_employee_id := p_assignment_id::UUID;
        ELSIF EXISTS (SELECT 1 FROM users WHERE id = p_assignment_id::UUID AND tenant_id = p_tenant_id) THEN
            v_user_id := p_assignment_id::UUID;
        ELSE
            RETURN QUERY SELECT FALSE, NULL::UUID,
                ('Assignment ID not found in employees or users: "' || p_assignment_id || '"')::TEXT;
            RETURN;
        END IF;
    END IF;

    -- Validate service requirements if service_id provided
    IF p_service_id IS NOT NULL THEN
        SELECT s.required_skills, s.required_resources INTO v_required_skills, v_required_resources
        FROM services s WHERE s.id = p_service_id AND s.tenant_id = p_tenant_id;

        IF v_required_resources IS NOT NULL AND array_length(v_required_resources, 1) > 0 THEN
            SELECT COALESCE(r.capabilities, '{}') INTO v_resource_caps FROM resources r WHERE r.id = p_resource_id;
            IF NOT v_required_resources <@ v_resource_caps THEN
                RETURN QUERY SELECT FALSE, NULL::UUID, 'Resource does not have required capabilities for this service'::TEXT;
                RETURN;
            END IF;
        END IF;

        IF v_employee_id IS NOT NULL AND v_required_skills IS NOT NULL AND array_length(v_required_skills, 1) > 0 THEN
            SELECT COALESCE(e.skills, '{}') INTO v_employee_skills
            FROM employees e WHERE e.id = v_employee_id AND e.tenant_id = p_tenant_id;
            IF NOT v_required_skills <@ v_employee_skills THEN
                RETURN QUERY SELECT FALSE, NULL::UUID, 'Employee does not have required skills for this service'::TEXT;
                RETURN;
            END IF;
        END IF;
    END IF;

    -- 1. Check resource overlap
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
        -- 2. Check employee overlap
        SELECT EXISTS (
            SELECT 1 FROM appointments
            WHERE employee_id = v_employee_id AND status = 'scheduled'
              AND start_time < v_effective_end AND end_time > p_start_time
        ) INTO v_overlap_exists;
        IF v_overlap_exists THEN
            RETURN QUERY SELECT FALSE, NULL::UUID, 'Employee already booked'::TEXT;
            RETURN;
        END IF;

        -- 3. DST-safe shift check using employee_schedule (date-based only)
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

    -- 4. Insert appointment
    INSERT INTO appointments (
        tenant_id, resource_id, customer_id, start_time, end_time,
        description, call_id, status, location, employee_id, assigned_to_user_id
    ) VALUES (
        p_tenant_id, p_resource_id, v_actual_customer_id, p_start_time, v_effective_end,
        COALESCE(p_description, 'Appointment'), p_call_id, 'scheduled', p_location,
        v_employee_id, v_user_id
    ) RETURNING id INTO v_new_appointment_id;

    RETURN QUERY SELECT TRUE, v_new_appointment_id, NULL::TEXT;
END;
$function$;

-- 8. Update book_with_scheduling_atomic — use employee_schedule, remove employee_shifts fallback
DROP FUNCTION IF EXISTS book_with_scheduling_atomic(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], TEXT[], UUID, TEXT, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION book_with_scheduling_atomic(
    p_tenant_id UUID,
    p_phone TEXT,
    p_customer_name TEXT DEFAULT NULL,
    p_description TEXT DEFAULT 'Booking via SecretaryHQ',
    p_call_id TEXT DEFAULT NULL,
    p_location TEXT DEFAULT NULL,
    p_start_time TIMESTAMPTZ DEFAULT NULL,
    p_end_time TIMESTAMPTZ DEFAULT NULL,
    p_window_from TIMESTAMPTZ DEFAULT NULL,
    p_window_to TIMESTAMPTZ DEFAULT NULL,
    p_required_skills TEXT[] DEFAULT '{}',
    p_required_capabilities TEXT[] DEFAULT '{}',
    p_preferred_resource_id UUID DEFAULT NULL,
    p_preferred_employee_id TEXT DEFAULT NULL,
    p_service_type TEXT DEFAULT NULL,
    p_duration_minutes INTEGER DEFAULT 30
) RETURNS TABLE (
    success BOOLEAN,
    appointment_id UUID,
    resource_id UUID,
    resource_name TEXT,
    employee_id UUID,
    employee_name TEXT,
    booked_start TIMESTAMPTZ,
    booked_end TIMESTAMPTZ,
    customer_id UUID,
    error_message TEXT,
    error_code TEXT
) AS $$
DECLARE
    v_customer_id UUID;
    v_resource_id UUID;
    v_resource_name TEXT;
    v_employee_id UUID := NULL;
    v_employee_name TEXT := NULL;
    v_start TIMESTAMPTZ;
    v_end TIMESTAMPTZ;
    v_appointment_id UUID;
    v_day_of_week INTEGER;
    v_start_time_of_day TIME;
    v_end_time_of_day TIME;
    v_shift_date DATE;
    v_duration INTERVAL;
    v_found BOOLEAN := FALSE;
    v_tenant_tz TEXT;
    v_employee_exists BOOLEAN;
    v_employee_scheduled BOOLEAN;
    v_resource_occupied BOOLEAN;
    v_employee_occupied BOOLEAN;
    r RECORD;
BEGIN
    -- STEP 0: Get tenant timezone
    SELECT COALESCE(t.timezone, 'America/Chicago') INTO v_tenant_tz
            FROM tenants t WHERE t.id = p_tenant_id;

    -- STEP 1: Determine booking window
    IF p_start_time IS NOT NULL AND p_end_time IS NOT NULL THEN
        v_start := p_start_time;
        v_end := p_end_time;
    ELSIF p_window_from IS NOT NULL AND p_window_to IS NOT NULL THEN
        v_start := p_window_from;
        IF p_service_type IS NOT NULL THEN
            SELECT duration_minutes INTO p_duration_minutes
            FROM services
            WHERE tenant_id = p_tenant_id AND name ILIKE '%' || p_service_type || '%'
            LIMIT 1;
        END IF;
        v_end := v_start + (COALESCE(p_duration_minutes, 30) || ' minutes')::INTERVAL;
    ELSE
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::UUID,
            'Either (start_time + end_time) or (window_from + window_to) required'::TEXT,
            'INVALID_PARAMS'::TEXT;
        RETURN;
    END IF;

    v_duration := (COALESCE(p_duration_minutes, 30) || ' minutes')::INTERVAL;
    v_day_of_week := EXTRACT(DOW FROM v_start AT TIME ZONE v_tenant_tz)::INTEGER;
    v_start_time_of_day := (v_start AT TIME ZONE v_tenant_tz)::TIME;
    v_end_time_of_day := (v_end AT TIME ZONE v_tenant_tz)::TIME;
    v_shift_date := (v_start AT TIME ZONE v_tenant_tz)::DATE;

    -- STEP 2: Customer upsert
    SELECT id INTO v_customer_id
    FROM customers
    WHERE tenant_id = p_tenant_id AND phone = p_phone;

    IF v_customer_id IS NULL THEN
        INSERT INTO customers (tenant_id, phone, name)
        VALUES (p_tenant_id, p_phone, COALESCE(p_customer_name, 'Caller'))
        RETURNING id INTO v_customer_id;
    END IF;

    -- STEP 3: Find best (resource, employee) pair using employee_schedule
    IF array_length(p_required_skills, 1) IS NOT NULL AND array_length(p_required_skills, 1) > 0 THEN
        FOR r IN
            SELECT
                res.id AS rid,
                res.name AS rname,
                emp.id AS eid,
                emp.name AS ename
            FROM resources res
            CROSS JOIN employees emp
            JOIN employee_schedule es
                ON es.employee_id = emp.id
                AND es.tenant_id = p_tenant_id
                AND es.shift_date = v_shift_date
                AND es.is_off = false
                AND es.start_time <= v_start_time_of_day
                AND es.end_time >= v_end_time_of_day
            WHERE res.tenant_id = p_tenant_id
                AND res.is_active = true
                AND emp.tenant_id = p_tenant_id
                AND emp.is_active = true
                AND (emp.is_deleted IS NULL OR emp.is_deleted = false)
                AND (array_length(p_required_capabilities, 1) IS NULL
                     OR res.capabilities @> p_required_capabilities)
                AND emp.skills @> p_required_skills
                AND NOT EXISTS (
                    SELECT 1 FROM appointments a
                    WHERE a.resource_id = res.id
                    AND a.status = 'scheduled'
                    AND a.start_time < v_end AND a.end_time > v_start
                )
                AND NOT EXISTS (
                    SELECT 1 FROM appointments a
                    WHERE a.employee_id = emp.id
                    AND a.status = 'scheduled'
                    AND a.start_time < v_end AND a.end_time > v_start
                )
                AND (p_preferred_resource_id IS NULL OR res.id = p_preferred_resource_id)
                AND (p_preferred_employee_id IS NULL OR emp.id = p_preferred_employee_id::UUID)
            ORDER BY
                CASE WHEN res.id = p_preferred_resource_id THEN 0 ELSE 1 END,
                CASE WHEN emp.id = p_preferred_employee_id::UUID THEN 0 ELSE 1 END,
                res.name, emp.name
            LIMIT 1
        LOOP
            v_resource_id := r.rid;
            v_resource_name := r.rname;
            v_employee_id := r.eid;
            v_employee_name := r.ename;
            v_found := TRUE;
        END LOOP;
    ELSE
        -- MODE B: Resource-only booking
        FOR r IN
            SELECT res.id AS rid, res.name AS rname
            FROM resources res
            WHERE res.tenant_id = p_tenant_id
                AND res.is_active = true
                AND (array_length(p_required_capabilities, 1) IS NULL
                     OR res.capabilities @> p_required_capabilities)
                AND NOT EXISTS (
                    SELECT 1 FROM appointments a
                    WHERE a.resource_id = res.id
                    AND a.status = 'scheduled'
                    AND a.start_time < v_end AND a.end_time > v_start
                )
                AND (p_preferred_resource_id IS NULL OR res.id = p_preferred_resource_id)
            ORDER BY
                CASE WHEN res.id = p_preferred_resource_id THEN 0 ELSE 1 END,
                res.name
            LIMIT 1
        LOOP
            v_resource_id := r.rid;
            v_resource_name := r.rname;
            v_found := TRUE;
        END LOOP;
    END IF;

    -- STEP 3b: Diagnose specific failure reason
    IF NOT v_found THEN
        IF array_length(p_required_skills, 1) IS NOT NULL AND array_length(p_required_skills, 1) > 0 THEN
            SELECT EXISTS(
                SELECT 1 FROM employees
                WHERE tenant_id = p_tenant_id
                AND is_active = true
                AND (is_deleted IS NULL OR is_deleted = false)
                AND skills @> p_required_skills
            ) INTO v_employee_exists;

            IF NOT v_employee_exists THEN
                RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
                    NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, v_customer_id,
                    'No employee with required skills available'::TEXT,
                    'NO_SKILLED_EMPLOYEE'::TEXT;
                RETURN;
            END IF;

            -- Check if skilled employee is scheduled
            SELECT EXISTS(
                SELECT 1 FROM employees emp
                JOIN employee_schedule es
                    ON es.employee_id = emp.id
                    AND es.tenant_id = p_tenant_id
                    AND es.shift_date = v_shift_date
                    AND es.is_off = false
                    AND es.start_time <= v_start_time_of_day
                    AND es.end_time >= v_end_time_of_day
                WHERE emp.tenant_id = p_tenant_id
                AND emp.is_active = true
                AND (emp.is_deleted IS NULL OR emp.is_deleted = false)
                AND emp.skills @> p_required_skills
            ) INTO v_employee_scheduled;

            IF NOT v_employee_scheduled THEN
                RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
                    NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, v_customer_id,
                    'No employee available during requested time'::TEXT,
                    'EMPLOYEE_NOT_SCHEDULED'::TEXT;
                RETURN;
            END IF;

            SELECT EXISTS(
                SELECT 1 FROM appointments a
                JOIN resources res ON res.id = a.resource_id
                WHERE res.tenant_id = p_tenant_id
                AND res.is_active = true
                AND a.status = 'scheduled'
                AND a.start_time < v_end AND a.end_time > v_start
            ) INTO v_resource_occupied;

            SELECT EXISTS(
                SELECT 1 FROM appointments a
                JOIN employees emp ON emp.id = a.employee_id
                WHERE emp.tenant_id = p_tenant_id
                AND emp.is_active = true
                AND (emp.is_deleted IS NULL OR emp.is_deleted = false)
                AND emp.skills @> p_required_skills
                AND a.status = 'scheduled'
                AND a.start_time < v_end AND a.end_time > v_start
            ) INTO v_employee_occupied;

            IF v_employee_occupied OR v_resource_occupied THEN
                RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
                    NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, v_customer_id,
                    'Requested time slot is already booked'::TEXT,
                    'TIMESLOT_OCCUPIED'::TEXT;
                RETURN;
            END IF;
        END IF;

        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, v_customer_id,
            'No available resource/employee combination found'::TEXT,
            'NO_AVAILABILITY'::TEXT;
        RETURN;
    END IF;

    -- STEP 4: Insert appointment
    INSERT INTO appointments (
        tenant_id, resource_id, customer_id, start_time, end_time,
        description, call_id, location, employee_id
    ) VALUES (
        p_tenant_id, v_resource_id, v_customer_id, v_start, v_end,
        p_description, p_call_id, p_location, v_employee_id
    ) RETURNING id INTO v_appointment_id;

    -- STEP 5: Return success
    RETURN QUERY SELECT TRUE, v_appointment_id, v_resource_id, v_resource_name,
        v_employee_id, v_employee_name, v_start, v_end, v_customer_id, NULL::TEXT, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION book_with_scheduling_atomic IS
'Atomic booking with scheduling. Uses employee_schedule (date-based) for shift validation.
Error codes: TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED, NO_AVAILABILITY, INVALID_PARAMS';
