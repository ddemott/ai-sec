-- Pilot #9 of the PK naming convention conversion (per CODING_STANDARDS.md).
-- Renames services.id → service_id.
--
-- 3 inbound FKs: service_employee.service_id, service_resource.service_id,
-- appointments.service_id. All already correctly named; the rename closes
-- the asymmetry so `services.service_id = service_employee.service_id`
-- can use `USING (service_id)`.
--
-- 2 RPCs reference services.id: book_appointment_atomic + check_coverage_gaps.
-- book_with_scheduling_atomic touches `FROM services` (name filter, no
-- id reference) — no change needed there. Both recreated below via CREATE
-- OR REPLACE; neither's RETURNS shape changes so plain replace works.
-- check_coverage_gaps already RETURNED `service_id uuid` as its output
-- column name (pre-existing convention match — the underlying source
-- column was the asymmetric `s.id`).

BEGIN;

ALTER TABLE services RENAME COLUMN id TO service_id;

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
    FROM tenants t WHERE t.id = p_tenant_id;
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
            FROM resources r WHERE r.id = p_resource_id;
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

CREATE OR REPLACE FUNCTION public.check_coverage_gaps(p_tenant_id uuid, p_start_date date DEFAULT CURRENT_DATE, p_end_date date DEFAULT (CURRENT_DATE + 6))
 RETURNS TABLE(service_id uuid, service_name text, check_date date, gap_hours integer[], covered_hours integer[], total_open_hours integer, coverage_pct numeric, status text, details jsonb)
 LANGUAGE plpgsql
 STABLE
AS $function$
BEGIN
    RETURN QUERY
    WITH tenant_services AS (
        SELECT s.service_id AS sid, s.name AS sname
        FROM services s
        WHERE s.tenant_id = p_tenant_id
    ),
    date_series AS (
        SELECT d::DATE AS check_date
        FROM generate_series(p_start_date, p_end_date, '1 day'::INTERVAL) AS d
    ),
    hourly_coverage AS (
        SELECT
            ts.sid,
            ds.check_date,
            h.hr,
            CASE WHEN EXISTS (
                SELECT 1
                FROM service_employee se
                JOIN employees e ON e.id = se.employee_id
                JOIN employee_schedule sch
                    ON sch.employee_id = e.id
                    AND sch.tenant_id = p_tenant_id
                    AND sch.shift_date = ds.check_date
                    AND sch.is_off = false
                WHERE se.service_id = ts.sid
                  AND e.tenant_id = p_tenant_id
                  AND e.is_active = true
                  AND (e.is_deleted IS NULL OR e.is_deleted = false)
                  AND sch.start_time <= make_time(h.hr, 0, 0)
                  AND sch.end_time > make_time(h.hr, 0, 0)
            ) THEN true ELSE false END AS is_covered
        FROM tenant_services ts
        CROSS JOIN date_series ds
        CROSS JOIN generate_series(0, 23) AS h(hr)
    ),
    open_hours AS (
        SELECT
            ds.check_date,
            h.hr
        FROM date_series ds
        CROSS JOIN generate_series(0, 23) AS h(hr)
        WHERE EXISTS (
            SELECT 1 FROM employees e
            JOIN employee_schedule sch
                ON sch.employee_id = e.id
                AND sch.tenant_id = p_tenant_id
                AND sch.shift_date = ds.check_date
                AND sch.is_off = false
            WHERE e.tenant_id = p_tenant_id
              AND e.is_active = true
              AND (e.is_deleted IS NULL OR e.is_deleted = false)
              AND sch.start_time <= make_time(h.hr, 0, 0)
              AND sch.end_time > make_time(h.hr, 0, 0)
        )
    ),
    service_coverage AS (
        SELECT
            hc.sid,
            hc.check_date,
            array_agg(DISTINCT hc.hr ORDER BY hc.hr) FILTER (WHERE NOT hc.is_covered AND oh.hr IS NOT NULL) AS gap_hrs,
            array_agg(DISTINCT hc.hr ORDER BY hc.hr) FILTER (WHERE hc.is_covered AND oh.hr IS NOT NULL) AS covered_hrs,
            COUNT(DISTINCT oh.hr) AS open_count,
            COUNT(DISTINCT hc.hr) FILTER (WHERE hc.is_covered AND oh.hr IS NOT NULL) AS covered_count
        FROM hourly_coverage hc
        LEFT JOIN open_hours oh ON oh.check_date = hc.check_date AND oh.hr = hc.hr
        GROUP BY hc.sid, hc.check_date
    )
    SELECT
        sc.sid,
        ts.sname,
        sc.check_date,
        COALESCE(sc.gap_hrs, '{}')::INTEGER[],
        COALESCE(sc.covered_hrs, '{}')::INTEGER[],
        sc.open_count::INTEGER,
        CASE WHEN sc.open_count > 0 THEN ROUND((sc.covered_count::NUMERIC / sc.open_count) * 100, 1) ELSE 100.0 END,
        CASE
            WHEN sc.open_count = 0 THEN 'closed'
            WHEN sc.covered_count = sc.open_count THEN 'full'
            WHEN sc.covered_count >= (sc.open_count * 0.8) THEN 'good'
            WHEN sc.covered_count >= (sc.open_count * 0.5) THEN 'partial'
            ELSE 'gap'
        END,
        jsonb_build_object(
            'gap_details', (
                SELECT jsonb_agg(jsonb_build_object('hour', g_hr, 'employees_needed', 1))
                FROM unnest(COALESCE(sc.gap_hrs, '{}')) AS g_hr
            )
        )
    FROM service_coverage sc
    JOIN tenant_services ts ON ts.sid = sc.sid
    ORDER BY sc.check_date, ts.sname;
END;
$function$;

COMMIT;
