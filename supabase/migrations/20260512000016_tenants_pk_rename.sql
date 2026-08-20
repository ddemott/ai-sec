-- Renames tenants.id → tenant_id.
--
-- Pilot #16 (final) of the PK naming convention conversion (per
-- CODING_STANDARDS.md). Biggest blast-radius pilot but also the
-- biggest JOIN-symmetry win — every tenant-scoped table already
-- carries `tenant_id` as its FK column, so after this rename
-- `tenants.tenant_id = customers.tenant_id` etc. lets every
-- inbound JOIN use `USING (tenant_id)` symmetrically.
--
-- 32 inbound FK columns reference `tenants(id)` (across appointments,
-- customers, employees, services, resources, users, voice_sessions,
-- record_versions, audit_log, reminder_schedules, consent_records,
-- opt_out_records, tenant_docs, tenant_skills, tenant_calendar_settings,
-- entity_sync_map, business_templates, tenant_integration_settings,
-- soft_reservations, call_summaries, call_transcripts, leads,
-- password_resets, phone_verifications, knowledge_documents, etc).
-- All track the column by oid so the rename leaves them intact —
-- the rename only needs to update the SOURCE side.
--
-- Functions/triggers that reference `tenants.id` in their body and
-- need recreation:
--   - book_appointment_atomic (`FROM tenants t WHERE t.id`)
--   - book_with_scheduling_atomic (same)
--   - check_availability_with_tz (`FROM tenants t WHERE t.id`)
--   - check_coverage_gaps (`FROM tenants t WHERE t.id` — used inside
--     the inner CTE for tenant timezone)
--   - get_customer_context_for_call (no direct tenants.id reference —
--     skipped)
--   - update_appointment_customer (no direct tenants.id reference)
--   - auto_version_trigger (cascade-guard `SELECT 1 FROM tenants
--     WHERE id = v_tenant_id`)
--   - fn_audit_trigger (same cascade-guard pattern)
--   - notify_n8n_on_appointment trigger function (`FROM tenants
--     WHERE id = NEW.tenant_id` lookup + `NEW.id` ref that should
--     have been `NEW.appointment_id` post-pilot-14 — fixed here)

ALTER TABLE tenants RENAME COLUMN id TO tenant_id;

-- ────────────────────────────────────────────────────────────────────
-- 1. book_appointment_atomic — single `t.id → t.tenant_id` in tz lookup.
-- ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.book_appointment_atomic(p_tenant_id uuid, p_resource_id uuid, p_customer_id uuid DEFAULT NULL::uuid, p_start_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_description text DEFAULT NULL::text, p_call_id text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_assignment_id text DEFAULT NULL::text, p_service_id uuid DEFAULT NULL::uuid, p_customer_phone text DEFAULT NULL::text, p_customer_name text DEFAULT NULL::text)
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
-- 2. book_with_scheduling_atomic — same `t.id → t.tenant_id` in tz lookup.
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
    v_tenant_tz TEXT;
    v_found BOOLEAN := FALSE;
    r RECORD;
    v_employee_exists BOOLEAN := FALSE;
    v_employee_scheduled BOOLEAN;
    v_employee_occupied BOOLEAN;
    v_resource_occupied BOOLEAN;
BEGIN
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
                    AND a.start_time < v_end AND a.end_time > v_start
                )
                AND NOT EXISTS (
                    SELECT 1 FROM appointments a
                    WHERE a.employee_id = emp.employee_id
                    AND a.status = 'scheduled'
                    AND a.start_time < v_end AND a.end_time > v_start
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
                    AND a.start_time < v_end AND a.end_time > v_start
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
                AND a.start_time < v_end AND a.end_time > v_start
            ) INTO v_resource_occupied;

            SELECT EXISTS(
                SELECT 1 FROM appointments a
                JOIN employees emp ON emp.employee_id = a.employee_id
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
Error codes: TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED, NO_AVAILABILITY, INVALID_PARAMS';

-- ────────────────────────────────────────────────────────────────────
-- 3. check_availability_with_tz — `tenants WHERE id` lookup
-- ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_availability_with_tz(
    p_tenant_id uuid,
    p_resource_id uuid,
    p_start_time timestamp with time zone,
    p_end_time timestamp with time zone,
    p_customer_tz text DEFAULT NULL::text
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
BEGIN
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
        AND start_time < p_end_time
        AND end_time > p_start_time
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

-- ────────────────────────────────────────────────────────────────────
-- 4. auto_version_trigger CASE — guard switches to tenant_id.
--    The CASE TG_TABLE_NAME mapping doesn't include tenants (tenants
--    isn't a versioned child table), so no new branch. Only the
--    cascade-delete guard `SELECT 1 FROM tenants WHERE id` switches.
-- ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION auto_version_trigger()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
  v_change_type TEXT;
  v_changed_fields TEXT[] := '{}';
  v_previous_values JSONB := '{}';
  v_change_source TEXT;
  v_change_summary TEXT;
  v_key TEXT;
  v_pk_column TEXT;
  v_record_id UUID;
BEGIN
  v_pk_column := CASE TG_TABLE_NAME
    WHEN 'voice_sessions' THEN 'voice_session_id'
    WHEN 'services' THEN 'service_id'
    WHEN 'resources' THEN 'resource_id'
    WHEN 'employees' THEN 'employee_id'
    WHEN 'appointments' THEN 'appointment_id'
    WHEN 'customers' THEN 'customer_id'
    ELSE 'id'
  END;

  IF TG_OP = 'DELETE' THEN
    v_tenant_id := OLD.tenant_id;
  ELSE
    v_tenant_id := NEW.tenant_id;
  END IF;

  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM tenants WHERE tenant_id = v_tenant_id
  ) THEN
    RETURN OLD;
  END IF;

  v_change_source := COALESCE(current_setting('app.change_source', true), 'local');
  IF v_change_source = '' THEN v_change_source := 'local'; END IF;

  IF TG_OP = 'INSERT' THEN
    v_change_type := 'create';
    v_change_summary := 'Record created';
  ELSIF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(OLD) ->> 'is_deleted')::BOOLEAN IS DISTINCT FROM (to_jsonb(NEW) ->> 'is_deleted')::BOOLEAN THEN
      IF (to_jsonb(NEW) ->> 'is_deleted')::BOOLEAN = true THEN
        v_change_type := 'delete';
        v_change_summary := 'Record soft-deleted';
      ELSE
        v_change_type := 'restore';
        v_change_summary := 'Record restored from soft-delete';
      END IF;
    ELSE
      v_change_type := 'update';
      FOR v_key IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
        IF v_key NOT IN ('updated_at', 'created_at') THEN
          IF (to_jsonb(NEW) -> v_key) IS DISTINCT FROM (to_jsonb(OLD) -> v_key) THEN
            v_changed_fields := array_append(v_changed_fields, v_key);
            v_previous_values := v_previous_values || jsonb_build_object(v_key, to_jsonb(OLD) -> v_key);
          END IF;
        END IF;
      END LOOP;

      IF array_length(v_changed_fields, 1) IS NULL THEN
        RETURN NEW;
      END IF;

      v_change_summary := generate_change_summary(v_changed_fields, v_previous_values, to_jsonb(NEW));
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_change_type := 'delete';
    v_change_summary := 'Record permanently deleted';
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_record_id := (to_jsonb(OLD) ->> v_pk_column)::UUID;
    PERFORM create_record_version(
      v_tenant_id, TG_TABLE_NAME, v_record_id,
      to_jsonb(OLD), v_changed_fields, v_previous_values,
      v_change_type, v_change_source,
      current_setting('app.changed_by', true),
      v_change_summary
    );
    RETURN OLD;
  ELSE
    v_record_id := (to_jsonb(NEW) ->> v_pk_column)::UUID;
    PERFORM create_record_version(
      v_tenant_id, TG_TABLE_NAME, v_record_id,
      to_jsonb(NEW), v_changed_fields, v_previous_values,
      v_change_type, v_change_source,
      current_setting('app.changed_by', true),
      v_change_summary
    );
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────────────
-- 5. fn_audit_trigger — guard switches to tenant_id.
-- ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_audit_trigger()
RETURNS TRIGGER
SECURITY DEFINER
AS $$
DECLARE
  v_pk_column TEXT;
  v_record_id TEXT;
BEGIN
  v_pk_column := CASE TG_TABLE_NAME
    WHEN 'resources' THEN 'resource_id'
    WHEN 'appointments' THEN 'appointment_id'
    WHEN 'customers' THEN 'customer_id'
    ELSE 'id'
  END;

  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM tenants WHERE tenant_id = OLD.tenant_id) THEN
      RETURN OLD;
    END IF;
    v_record_id := to_jsonb(OLD) ->> v_pk_column;
    INSERT INTO audit_log (tenant_id, table_name, record_id, action, old_data, changed_by)
    VALUES (OLD.tenant_id, TG_TABLE_NAME, v_record_id, 'DELETE', to_jsonb(OLD),
            current_setting('app.current_tenant_id', true));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    v_record_id := to_jsonb(NEW) ->> v_pk_column;
    INSERT INTO audit_log (tenant_id, table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (NEW.tenant_id, TG_TABLE_NAME, v_record_id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW),
            current_setting('app.current_tenant_id', true));
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    v_record_id := to_jsonb(NEW) ->> v_pk_column;
    INSERT INTO audit_log (tenant_id, table_name, record_id, action, new_data, changed_by)
    VALUES (NEW.tenant_id, TG_TABLE_NAME, v_record_id, 'INSERT', to_jsonb(NEW),
            current_setting('app.current_tenant_id', true));
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────────────
-- 6. notify_n8n_on_appointment — fix `WHERE id = NEW.tenant_id` lookup,
--    and the stale `NEW.id` payload field (appointments.id was renamed
--    in pilot 14, so NEW.id is undefined on this row).
-- ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION notify_n8n_on_appointment()
RETURNS TRIGGER AS $$
DECLARE
    v_webhook_url TEXT;
    v_payload JSONB;
BEGIN
    SELECT n8n_webhook_url INTO v_webhook_url
    FROM tenants WHERE tenant_id = NEW.tenant_id;

    IF v_webhook_url IS NULL OR v_webhook_url = '' THEN
        RAISE NOTICE 'No n8n webhook configured for tenant %', NEW.tenant_id;
        RETURN NEW;
    END IF;

    v_payload := jsonb_build_object(
        'event', 'appointment.created',
        'tenant_id', NEW.tenant_id,
        'appointment_id', NEW.appointment_id,
        'resource_id', NEW.resource_id,
        'customer_id', NEW.customer_id,
        'start_time', NEW.start_time,
        'end_time', NEW.end_time,
        'description', NEW.description,
        'created_at', NOW()
    );

    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
        EXECUTE format(
            'SELECT net.http_post(url := %L, headers := %L::JSONB, body := %L)',
            v_webhook_url,
            '{"Content-Type": "application/json"}',
            v_payload::TEXT
        );
    ELSE
        RAISE NOTICE 'n8n webhook payload for tenant %: %', NEW.tenant_id, v_payload;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────────────────────────────────
-- 7. create_default_resources trigger function — references NEW.id on
--    the tenants table, which is now NEW.tenant_id post-rename.
--    Discovered when test_db `INSERT INTO tenants RETURNING tenant_id AS id`
--    raised `record "new" has no field "id"`.
-- ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_default_resources()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_template business_templates%ROWTYPE;
BEGIN
    SELECT * INTO v_template FROM business_templates WHERE business_type = NEW.business_type;

    IF FOUND THEN
        INSERT INTO resources (tenant_id, name, description)
        VALUES (NEW.tenant_id, v_template.default_resource_name, v_template.default_resource_description);
    END IF;

    RETURN NEW;
END;
$function$;

