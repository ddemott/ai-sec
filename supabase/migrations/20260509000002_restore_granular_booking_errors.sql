-- Restore granular booking error codes in book_with_scheduling_atomic.
--
-- Background. Migration 20260401000001 introduced four specific failure
-- codes (NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED, TIMESLOT_OCCUPIED,
-- NO_AVAILABILITY) so the agent prompt could speak them aloud differently:
--   NO_SKILLED_EMPLOYEE   → "We don't have someone trained for that service at that time."
--   EMPLOYEE_NOT_SCHEDULED → "Our tech isn't on the schedule then."
--   TIMESLOT_OCCUPIED      → "That time just got taken."
--   NO_AVAILABILITY        → "Nothing's open there — want to pick another time?"
--
-- Migration 20260508000001 rewrote the RPC to change the auto-assignment
-- policy (fewest-skills + least-busy + random — see that migration's
-- comment for rationale). The rewrite kept TIMESLOT_OCCUPIED via the
-- exclusion-violation handler, but accidentally collapsed the other three
-- into a single NO_AVAILABILITY return when the candidate JOIN produced
-- no rows. That regressed the caller experience: the agent now says
-- "nothing's open there" when the real issue is "we don't have a tech
-- with that skill" — misleading and unhelpful.
--
-- This migration keeps the 2026-05-08 assignment policy intact and
-- re-incorporates the diagnostic block from 20260401000001, updated to
-- use `employee_schedule` (employee_shifts was dropped 2026-04-30 in
-- migration 20260430000002).

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
    v_start_time_of_day TIME;
    v_end_time_of_day TIME;
    v_shift_date DATE;
    v_duration INTERVAL;
    v_found BOOLEAN := FALSE;
    v_tenant_tz TEXT;
    v_employee_exists BOOLEAN;
    v_employee_scheduled BOOLEAN;
    v_employee_occupied BOOLEAN;
    v_resource_occupied BOOLEAN;
    r RECORD;
BEGIN
    SELECT COALESCE(t.timezone, 'America/Chicago') INTO v_tenant_tz
            FROM tenants t WHERE t.id = p_tenant_id;

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
    v_start_time_of_day := (v_start AT TIME ZONE v_tenant_tz)::TIME;
    v_end_time_of_day := (v_end AT TIME ZONE v_tenant_tz)::TIME;
    v_shift_date := (v_start AT TIME ZONE v_tenant_tz)::DATE;

    SELECT id INTO v_customer_id
    FROM customers
    WHERE tenant_id = p_tenant_id AND phone = p_phone;

    IF v_customer_id IS NULL THEN
        INSERT INTO customers (tenant_id, phone, name)
        VALUES (p_tenant_id, p_phone, COALESCE(p_customer_name, 'Caller'))
        RETURNING id INTO v_customer_id;
    END IF;

    -- ════════════════════════════════════════════════════════════════
    -- STEP 1: Try to find a matching (resource, employee) pair using
    --         the 2026-05-08 assignment policy.
    -- ════════════════════════════════════════════════════════════════
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
                COALESCE(array_length(emp.skills, 1), 0) ASC,
                (
                    SELECT COUNT(*) FROM appointments a
                    WHERE a.tenant_id = p_tenant_id
                      AND a.employee_id = emp.id
                      AND a.status = 'scheduled'
                      AND (a.is_deleted IS NULL OR a.is_deleted = false)
                      AND (a.start_time AT TIME ZONE v_tenant_tz)::DATE = v_shift_date
                ) ASC,
                random()
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
            SELECT res.id AS rid, res.name AS rname
            FROM resources res
            WHERE res.tenant_id = p_tenant_id
                AND res.is_active = true
                AND (res.is_deleted IS NULL OR res.is_deleted = false)
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

    -- ════════════════════════════════════════════════════════════════
    -- STEP 2: Diagnose specific failure when no match was found.
    --         Restored from migration 20260401000001; updated to use
    --         employee_schedule instead of the dropped employee_shifts.
    -- ════════════════════════════════════════════════════════════════
    IF NOT v_found AND array_length(p_required_skills, 1) IS NOT NULL
       AND array_length(p_required_skills, 1) > 0 THEN

        -- Does ANY employee with the required skills exist for this tenant?
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

        -- The skilled employee exists — is anyone with that skill scheduled
        -- for the requested time?
        SELECT EXISTS(
            SELECT 1
            FROM employees emp
            INNER JOIN employee_schedule es ON es.employee_id = emp.id
            WHERE emp.tenant_id = p_tenant_id
              AND emp.is_active = true
              AND (emp.is_deleted IS NULL OR emp.is_deleted = false)
              AND emp.skills @> p_required_skills
              AND es.tenant_id = p_tenant_id
              AND es.shift_date = v_shift_date
              AND es.is_off = false
              AND es.start_time <= v_start_time_of_day
              AND es.end_time >= v_end_time_of_day
        ) INTO v_employee_scheduled;

        IF NOT v_employee_scheduled THEN
            RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
                NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, v_customer_id,
                'No employee available during requested time'::TEXT,
                'EMPLOYEE_NOT_SCHEDULED'::TEXT;
            RETURN;
        END IF;

        -- A skilled, scheduled employee exists, but the join didn't return
        -- one — must be that they're already booked OR every matching
        -- resource is occupied. Distinguish via two cheap exists checks.
        SELECT EXISTS(
            SELECT 1
            FROM employees emp
            INNER JOIN employee_schedule es ON es.employee_id = emp.id
            INNER JOIN appointments a ON a.employee_id = emp.id
            WHERE emp.tenant_id = p_tenant_id
              AND emp.is_active = true
              AND (emp.is_deleted IS NULL OR emp.is_deleted = false)
              AND emp.skills @> p_required_skills
              AND es.tenant_id = p_tenant_id
              AND es.shift_date = v_shift_date
              AND es.is_off = false
              AND es.start_time <= v_start_time_of_day
              AND es.end_time >= v_end_time_of_day
              AND a.status = 'scheduled'
              AND a.start_time < v_end AND a.end_time > v_start
        ) INTO v_employee_occupied;

        SELECT EXISTS(
            SELECT 1
            FROM resources res
            INNER JOIN appointments a ON a.resource_id = res.id
            WHERE res.tenant_id = p_tenant_id
              AND res.is_active = true
              AND a.status = 'scheduled'
              AND a.start_time < v_end AND a.end_time > v_start
        ) INTO v_resource_occupied;

        IF v_employee_occupied OR v_resource_occupied THEN
            RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
                NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, v_customer_id,
                'Requested time slot is already booked'::TEXT,
                'TIMESLOT_OCCUPIED'::TEXT;
            RETURN;
        END IF;

        -- Skilled, scheduled, slot is free, no one occupied — but the JOIN
        -- still didn't match. The remaining cases are subtler (capability
        -- mismatch on resources, an employee on a date-specific is_off
        -- override, the operator's preference filters didn't match). Fall
        -- through to NO_AVAILABILITY below.
    END IF;

    IF NOT v_found THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, v_customer_id,
            'No available scheduling options'::TEXT, 'NO_AVAILABILITY'::TEXT;
        RETURN;
    END IF;

    BEGIN
        INSERT INTO appointments (
            tenant_id, resource_id, customer_id, employee_id,
            start_time, end_time, description, call_id, status, location
        ) VALUES (
            p_tenant_id, v_resource_id, v_customer_id, v_employee_id,
            v_start, v_end, p_description, p_call_id, 'scheduled', p_location
        ) RETURNING id INTO v_appointment_id;
    EXCEPTION WHEN exclusion_violation THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, v_customer_id,
            'That time just got taken'::TEXT, 'TIMESLOT_OCCUPIED'::TEXT;
        RETURN;
    END;

    RETURN QUERY SELECT TRUE, v_appointment_id, v_resource_id, v_resource_name,
        v_employee_id, v_employee_name, v_start, v_end, v_customer_id,
        NULL::TEXT, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION book_with_scheduling_atomic IS
'Atomic agent-side booking with auto-assignment + granular error codes.
Assignment policy (2026-05-08): explicit preferences first, then fewest-
skills employee (senior-time preservation), then least-busy-today (load
balance), then random() (rotation). Failure diagnostics (2026-05-09
restoration of 2026-04-01 logic): NO_SKILLED_EMPLOYEE / EMPLOYEE_NOT_
SCHEDULED / TIMESLOT_OCCUPIED / NO_AVAILABILITY so the agent prompt can
speak each case differently. Concurrency-safe via the exclusion
constraints from migration 20260501000000.';
