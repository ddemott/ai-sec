-- Enforce the per-tenant "default buffer between appointments" inside the
-- booking + availability RPCs.
--
-- See 20260607000000_tenants_default_buffer.sql for the column + product intent.
-- This migration redefines the three customer-facing RPCs to accept a new
-- p_buffer_minutes parameter and pad every appointment-overlap check by that
-- many minutes, SYMMETRICALLY around each existing appointment. The effect:
-- a new booking is rejected unless there is at least p_buffer_minutes of gap on
-- both sides of every existing appointment for that resource / employee.
--
-- Math: the existing overlap test "existing.start < req.end AND existing.end >
-- req.start" detects [existing) overlapping [request). Expanding each existing
-- appointment by B on both sides — [start - B, end + B) — and re-testing is
-- algebraically "existing.start < req.end + B AND existing.end > req.start - B".
-- That rejects iff the gap to a neighbour is < B, and ALLOWS an exactly-B gap
-- (8:00-9:00 + 15m buffer permits a 9:15 start). Only the request bounds are
-- padded, never the stored times, so a 0-minute buffer reproduces the original
-- behavior byte-for-byte.
--
-- Scope gating lives at the CALL SITE, not here: p_buffer_minutes DEFAULTs to 0,
-- so every existing positional caller (the dashboard owner-booking route, tests,
-- internal callers) is unchanged and unrestricted. Only the agent / customer-
-- facing routes pass a non-zero buffer (the tenant's default_buffer_minutes).
-- This is how "buffer applies to AI bookings only, owner manual stays free" is
-- enforced without the RPC needing to know who called it.
--
-- Race note: buffer is enforced ONLY in these in-function checks, NOT in the
-- GiST exclusion constraints (appointments_no_resource_overlap / _employee_).
-- A per-tenant, runtime buffer cannot live in an immutable exclusion constraint
-- without denormalizing a (mutable, possibly-mismatched-across-rows) buffer onto
-- every appointment row — not worth it. The constraints remain the race-safe
-- backstop against a TRUE overlap (double-book). The only thing the in-function
-- check can lose to a concurrent racer is the BUFFER itself — i.e. two near-
-- simultaneous bookings could land 10 minutes apart under a 15-minute buffer.
-- That degradation is benign (a smaller-than-desired gap a human can fix), never
-- a double-book, and the race window is vanishingly small for the same resource.
-- Do not "fix" this by making the GiST constraint buffer-aware.

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1. book_appointment_atomic — + p_buffer_minutes; pad the 3 appointment
--    overlap checks (resource / employee / user). Shift-coverage checks
--    are NOT padded — buffer spaces appointments from each other, it does
--    not shrink the usable shift window.
-- ────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.book_appointment_atomic(uuid, uuid, uuid, timestamptz, timestamptz, text, text, text, text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.book_appointment_atomic(p_tenant_id uuid, p_resource_id uuid, p_customer_id uuid DEFAULT NULL::uuid, p_start_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_description text DEFAULT NULL::text, p_call_id text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_assignment_id text DEFAULT NULL::text, p_service_id uuid DEFAULT NULL::uuid, p_customer_phone text DEFAULT NULL::text, p_customer_name text DEFAULT NULL::text, p_buffer_minutes integer DEFAULT 0)
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
    v_buffer INTERVAL;
BEGIN
    v_buffer := (GREATEST(COALESCE(p_buffer_minutes, 0), 0) || ' minutes')::INTERVAL;

    SELECT COALESCE(t.timezone, 'UTC') INTO v_tenant_tz
    FROM tenants t WHERE t.tenant_id = p_tenant_id;
    IF v_tenant_tz IS NULL THEN v_tenant_tz := 'UTC'; END IF;

    IF p_end_time IS NULL AND p_service_id IS NOT NULL THEN
        SELECT s.duration_minutes INTO v_service_duration
        FROM services s WHERE s.service_id = p_service_id AND s.tenant_id = p_tenant_id;
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
        SELECT customer_id INTO v_actual_customer_id FROM customers
        WHERE tenant_id = p_tenant_id AND phone = p_customer_phone LIMIT 1;
        IF v_actual_customer_id IS NULL THEN
            INSERT INTO customers (tenant_id, phone, name)
            VALUES (p_tenant_id, p_customer_phone, COALESCE(p_customer_name, 'Unknown'))
            RETURNING customer_id INTO v_actual_customer_id;
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

        IF EXISTS (SELECT 1 FROM employees WHERE employee_id = p_assignment_id::UUID AND tenant_id = p_tenant_id) THEN
            v_employee_id := p_assignment_id::UUID;
        ELSIF EXISTS (SELECT 1 FROM users WHERE user_id = p_assignment_id::UUID AND tenant_id = p_tenant_id) THEN
            v_user_id := p_assignment_id::UUID;
        ELSE
            RETURN QUERY SELECT FALSE, NULL::UUID,
                ('Assignment ID not found in employees or users: "' || p_assignment_id || '"')::TEXT;
            RETURN;
        END IF;
    END IF;

    IF p_service_id IS NOT NULL THEN
        SELECT s.required_skills, s.required_resources INTO v_required_skills, v_required_resources
        FROM services s WHERE s.service_id = p_service_id AND s.tenant_id = p_tenant_id;

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
            SELECT COALESCE(r.capabilities, '{}') INTO v_resource_caps
            FROM resources r WHERE r.resource_id = p_resource_id;
            IF NOT v_required_resources <@ v_resource_caps THEN
                RETURN QUERY SELECT FALSE, NULL::UUID,
                    'Resource does not have required capabilities for this service'::TEXT;
                RETURN;
            END IF;
        END IF;

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
                SELECT COALESCE(e.skills, '{}') INTO v_employee_skills
                FROM employees e WHERE e.employee_id = v_employee_id AND e.tenant_id = p_tenant_id;
                IF NOT v_required_skills <@ v_employee_skills THEN
                    RETURN QUERY SELECT FALSE, NULL::UUID,
                        'Employee does not have required skills for this service'::TEXT;
                    RETURN;
                END IF;
            END IF;
        END IF;
    END IF;

    -- Resource overlap — padded by the buffer on both sides of the request.
    SELECT EXISTS (
        SELECT 1 FROM appointments
        WHERE resource_id = p_resource_id AND status = 'scheduled'
          AND start_time < v_effective_end + v_buffer AND end_time > p_start_time - v_buffer
    ) INTO v_overlap_exists;
    IF v_overlap_exists THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, 'Resource already booked during this timeslot'::TEXT;
        RETURN;
    END IF;

    IF v_employee_id IS NOT NULL THEN
        -- Employee overlap — padded by the buffer on both sides of the request.
        SELECT EXISTS (
            SELECT 1 FROM appointments
            WHERE employee_id = v_employee_id AND status = 'scheduled'
              AND start_time < v_effective_end + v_buffer AND end_time > p_start_time - v_buffer
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
        -- User overlap — padded by the buffer on both sides of the request.
        SELECT EXISTS (
            SELECT 1 FROM appointments
            WHERE assigned_to_user_id = v_user_id AND status = 'scheduled'
              AND start_time < v_effective_end + v_buffer AND end_time > p_start_time - v_buffer
        ) INTO v_overlap_exists;
        IF v_overlap_exists THEN
            RETURN QUERY SELECT FALSE, NULL::UUID, 'User already booked'::TEXT;
            RETURN;
        END IF;
    END IF;

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
        ) RETURNING appointments.appointment_id INTO v_new_appointment_id;
    EXCEPTION WHEN exclusion_violation THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, 'Resource already booked during this timeslot'::TEXT;
        RETURN;
    END;

    RETURN QUERY SELECT TRUE, v_new_appointment_id, NULL::TEXT;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────
-- 2. book_with_scheduling_atomic — + p_buffer_minutes; pad the 5 appointment
--    overlap checks (2 in the skilled selection loop, 1 in the unskilled
--    selection loop, 2 in the NO-availability diagnostic block). Shift /
--    skill coverage checks are NOT padded.
-- ────────────────────────────────────────────────────────────────────

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
    p_duration_minutes INTEGER DEFAULT 30,
    p_buffer_minutes INTEGER DEFAULT 0
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
    v_tenant_tz TEXT;
    v_found BOOLEAN := FALSE;
    r RECORD;
    v_employee_exists BOOLEAN := FALSE;
    v_employee_scheduled BOOLEAN;
    v_employee_occupied BOOLEAN;
    v_resource_occupied BOOLEAN;
    v_buffer INTERVAL;
BEGIN
    v_buffer := (GREATEST(COALESCE(p_buffer_minutes, 0), 0) || ' minutes')::INTERVAL;

    SELECT COALESCE(t.timezone, 'UTC') INTO v_tenant_tz
    FROM tenants t WHERE t.tenant_id = p_tenant_id;
    IF v_tenant_tz IS NULL THEN v_tenant_tz := 'UTC'; END IF;

    IF p_phone IS NULL OR p_phone = '' THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::UUID,
            'Phone number is required'::TEXT, 'INVALID_PARAMS'::TEXT;
        RETURN;
    END IF;

    IF p_start_time IS NULL OR p_end_time IS NULL THEN
        IF p_window_from IS NULL OR p_window_to IS NULL THEN
            RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
                NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, NULL::UUID,
                'Either (start_time, end_time) or (window_from, window_to) required'::TEXT,
                'INVALID_PARAMS'::TEXT;
            RETURN;
        END IF;
        v_start := p_window_from;
        v_end := v_start + (p_duration_minutes || ' minutes')::INTERVAL;
    ELSE
        v_start := p_start_time;
        v_end := p_end_time;
    END IF;

    SELECT customers.customer_id INTO v_customer_id FROM customers
    WHERE tenant_id = p_tenant_id AND phone = p_phone
      AND (is_deleted IS NULL OR is_deleted = false)
    LIMIT 1;
    IF v_customer_id IS NULL THEN
        INSERT INTO customers (tenant_id, phone, name)
        VALUES (p_tenant_id, p_phone, COALESCE(p_customer_name, 'Unknown'))
        RETURNING customers.customer_id INTO v_customer_id;
    END IF;

    v_shift_date := (v_start AT TIME ZONE v_tenant_tz)::DATE;
    v_day_of_week := EXTRACT(DOW FROM v_start AT TIME ZONE v_tenant_tz)::INTEGER;
    v_start_time_of_day := (v_start AT TIME ZONE v_tenant_tz)::TIME;
    v_end_time_of_day := (v_end AT TIME ZONE v_tenant_tz)::TIME;

    IF array_length(p_required_skills, 1) IS NOT NULL AND array_length(p_required_skills, 1) > 0 THEN
        FOR r IN
            SELECT
                res.resource_id AS rid,
                res.name AS rname,
                emp.employee_id AS eid,
                emp.name AS ename
            FROM resources res
            CROSS JOIN employees emp
            JOIN employee_schedule es
                ON es.employee_id = emp.employee_id
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
                    WHERE a.resource_id = res.resource_id
                    AND a.status = 'scheduled'
                    AND a.start_time < v_end + v_buffer AND a.end_time > v_start - v_buffer
                )
                AND NOT EXISTS (
                    SELECT 1 FROM appointments a
                    WHERE a.employee_id = emp.employee_id
                    AND a.status = 'scheduled'
                    AND a.start_time < v_end + v_buffer AND a.end_time > v_start - v_buffer
                )
                AND (p_preferred_resource_id IS NULL OR res.resource_id = p_preferred_resource_id)
                AND (p_preferred_employee_id IS NULL OR emp.employee_id = p_preferred_employee_id::UUID)
            ORDER BY
                CASE WHEN res.resource_id = p_preferred_resource_id THEN 0 ELSE 1 END,
                CASE WHEN emp.employee_id = p_preferred_employee_id::UUID THEN 0 ELSE 1 END,
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
        FOR r IN
            SELECT res.resource_id AS rid, res.name AS rname
            FROM resources res
            WHERE res.tenant_id = p_tenant_id
                AND res.is_active = true
                AND (array_length(p_required_capabilities, 1) IS NULL
                     OR res.capabilities @> p_required_capabilities)
                AND NOT EXISTS (
                    SELECT 1 FROM appointments a
                    WHERE a.resource_id = res.resource_id
                    AND a.status = 'scheduled'
                    AND a.start_time < v_end + v_buffer AND a.end_time > v_start - v_buffer
                )
                AND (p_preferred_resource_id IS NULL OR res.resource_id = p_preferred_resource_id)
            ORDER BY
                CASE WHEN res.resource_id = p_preferred_resource_id THEN 0 ELSE 1 END,
                res.name
            LIMIT 1
        LOOP
            v_resource_id := r.rid;
            v_resource_name := r.rname;
            v_found := TRUE;
        END LOOP;
    END IF;

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

            SELECT EXISTS(
                SELECT 1 FROM employees emp
                JOIN employee_schedule es
                    ON es.employee_id = emp.employee_id
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
                JOIN resources res ON res.resource_id = a.resource_id
                WHERE res.tenant_id = p_tenant_id
                AND res.is_active = true
                AND a.status = 'scheduled'
                AND a.start_time < v_end + v_buffer AND a.end_time > v_start - v_buffer
            ) INTO v_resource_occupied;

            SELECT EXISTS(
                SELECT 1 FROM appointments a
                JOIN employees emp ON emp.employee_id = a.employee_id
                WHERE emp.tenant_id = p_tenant_id
                AND emp.is_active = true
                AND (emp.is_deleted IS NULL OR emp.is_deleted = false)
                AND emp.skills @> p_required_skills
                AND a.status = 'scheduled'
                AND a.start_time < v_end + v_buffer AND a.end_time > v_start - v_buffer
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

    BEGIN
        INSERT INTO appointments (
            tenant_id, resource_id, customer_id, start_time, end_time,
            description, call_id, location, employee_id
        ) VALUES (
            p_tenant_id, v_resource_id, v_customer_id, v_start, v_end,
            p_description, p_call_id, p_location, v_employee_id
        ) RETURNING appointments.appointment_id INTO v_appointment_id;
    EXCEPTION WHEN exclusion_violation THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, v_customer_id,
            'Requested time slot is already booked'::TEXT,
            'TIMESLOT_OCCUPIED'::TEXT;
        RETURN;
    END;

    RETURN QUERY SELECT TRUE, v_appointment_id, v_resource_id, v_resource_name,
        v_employee_id, v_employee_name, v_start, v_end, v_customer_id, NULL::TEXT, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION book_with_scheduling_atomic IS
'Atomic booking with scheduling. Uses employee_schedule (date-based) for shift validation.
Concurrency-safe via appointments_no_resource_overlap / appointments_no_employee_overlap
exclusion constraints — race losers receive TIMESLOT_OCCUPIED.
p_buffer_minutes (default 0) pads appointment-overlap checks to enforce a minimum gap
between back-to-back bookings; 0 reproduces the original behavior exactly.
Error codes: TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED, NO_AVAILABILITY, INVALID_PARAMS';

-- ────────────────────────────────────────────────────────────────────
-- 3. check_availability_with_tz — + p_buffer_minutes; pad the single
--    resource-overlap check. Staff-shift availability is NOT padded.
-- ────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.check_availability_with_tz(uuid, uuid, timestamptz, timestamptz, text);

CREATE OR REPLACE FUNCTION public.check_availability_with_tz(
    p_tenant_id uuid,
    p_resource_id uuid,
    p_start_time timestamp with time zone,
    p_end_time timestamp with time zone,
    p_customer_tz text DEFAULT NULL::text,
    p_buffer_minutes integer DEFAULT 0
)
RETURNS TABLE(available boolean, tenant_timezone text, local_start text, local_end text)
LANGUAGE plpgsql
AS $function$
DECLARE
    v_tenant_tz TEXT;
    v_display_tz TEXT;
    v_resource_free BOOLEAN;
    v_staff_available BOOLEAN;
    v_shift_date DATE;
    v_day_of_week INTEGER;
    v_start_tod TIME;
    v_end_tod TIME;
    v_buffer INTERVAL;
BEGIN
    v_buffer := (GREATEST(COALESCE(p_buffer_minutes, 0), 0) || ' minutes')::INTERVAL;

    SELECT COALESCE(t.timezone, 'UTC') INTO v_tenant_tz
    FROM tenants t WHERE t.tenant_id = p_tenant_id;
    IF v_tenant_tz IS NULL THEN v_tenant_tz := 'UTC'; END IF;

    v_display_tz := COALESCE(p_customer_tz, v_tenant_tz);
    v_shift_date := (p_start_time AT TIME ZONE v_tenant_tz)::DATE;
    v_day_of_week := EXTRACT(DOW FROM p_start_time AT TIME ZONE v_tenant_tz)::INTEGER;
    v_start_tod := (p_start_time AT TIME ZONE v_tenant_tz)::TIME;
    v_end_tod := (p_end_time AT TIME ZONE v_tenant_tz)::TIME;

    SELECT NOT EXISTS (
        SELECT 1 FROM appointments
        WHERE resource_id = p_resource_id
        AND tenant_id = p_tenant_id
        AND status = 'scheduled'
        AND (is_deleted IS NULL OR is_deleted = false)
        AND start_time < p_end_time + v_buffer
        AND end_time > p_start_time - v_buffer
    ) INTO v_resource_free;

    SELECT EXISTS (
        SELECT 1 FROM employees emp
        INNER JOIN employee_schedule es ON es.employee_id = emp.employee_id
        WHERE emp.tenant_id = p_tenant_id
        AND emp.is_active = true
        AND (emp.is_deleted IS NULL OR emp.is_deleted = false)
        AND es.tenant_id = p_tenant_id
        AND es.shift_date = v_shift_date
        AND es.is_off = false
        AND (
            (es.start_time <= es.end_time AND es.start_time <= v_start_tod AND es.end_time >= v_end_tod)
            OR
            (es.start_time > es.end_time AND (v_start_tod >= es.start_time OR v_end_tod <= es.end_time))
        )
    ) INTO v_staff_available;

    RETURN QUERY SELECT
        (v_resource_free AND v_staff_available),
        v_display_tz,
        to_char(p_start_time AT TIME ZONE v_display_tz, 'YYYY-MM-DD HH24:MI'),
        to_char(p_end_time AT TIME ZONE v_display_tz, 'YYYY-MM-DD HH24:MI');
END;
$function$;

COMMIT;
