-- Fix 3 critical issues from architecture review:
-- #1: Booking RPC override logic bug (is_off=true bypass)
-- #2: check_coverage_gaps() ignores shift_overrides
-- #4: RLS admin bypass policy too permissive on shift_overrides

-- ═══════════════════════════════════════════════════════════════
-- FIX #4: Tighten RLS admin bypass policy
-- ═══════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Admin bypass for shift_overrides" ON shift_overrides;
CREATE POLICY "Admin bypass for shift_overrides" ON shift_overrides
    FOR ALL USING (
        NULLIF(current_setting('app.current_tenant_id', TRUE), '') IS NULL
    );

-- ═══════════════════════════════════════════════════════════════
-- FIX #1: Booking RPC — prevent is_off override from being bypassed by pattern
-- ═══════════════════════════════════════════════════════════════
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

    -- STEP 3: Find best (resource, employee) pair
    -- FIX #1: Override with is_off=true now correctly blocks the pattern fallback
    IF array_length(p_required_skills, 1) IS NOT NULL AND array_length(p_required_skills, 1) > 0 THEN
        FOR r IN
            SELECT
                res.id AS rid,
                res.name AS rname,
                emp.id AS eid,
                emp.name AS ename
            FROM resources res
            CROSS JOIN employees emp
            LEFT JOIN shift_overrides so
                ON so.employee_id = emp.id
                AND so.tenant_id = p_tenant_id
                AND so.shift_date = v_shift_date
            LEFT JOIN employee_shifts es
                ON es.employee_id = emp.id
                AND es.day_of_week = v_day_of_week
                AND es.is_active = true
                AND so.id IS NULL  -- only use pattern when no override exists
            WHERE res.tenant_id = p_tenant_id
                AND res.is_active = true
                AND emp.tenant_id = p_tenant_id
                AND emp.is_active = true
                AND (emp.is_deleted IS NULL OR emp.is_deleted = false)
                AND (array_length(p_required_capabilities, 1) IS NULL
                     OR res.capabilities @> p_required_capabilities)
                AND emp.skills @> p_required_skills
                -- Employee must be on shift: override (not off) OR pattern (no override)
                -- FIX: if override exists with is_off=true, both branches fail correctly
                AND (
                    (so.id IS NOT NULL AND so.is_off = false
                     AND so.start_time <= v_start_time_of_day
                     AND so.end_time >= v_end_time_of_day)
                    OR
                    (so.id IS NULL AND es.id IS NOT NULL
                     AND es.start_time <= v_start_time_of_day
                     AND es.end_time >= v_end_time_of_day)
                )
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

            -- Check if skilled employee is scheduled (override or pattern)
            -- FIX: Same logic — is_off override blocks pattern fallback
            SELECT EXISTS(
                SELECT 1 FROM employees emp
                LEFT JOIN shift_overrides so
                    ON so.employee_id = emp.id
                    AND so.tenant_id = p_tenant_id
                    AND so.shift_date = v_shift_date
                LEFT JOIN employee_shifts es
                    ON es.employee_id = emp.id
                    AND es.day_of_week = v_day_of_week
                    AND es.is_active = true
                    AND so.id IS NULL
                WHERE emp.tenant_id = p_tenant_id
                AND emp.is_active = true
                AND (emp.is_deleted IS NULL OR emp.is_deleted = false)
                AND emp.skills @> p_required_skills
                AND (
                    (so.id IS NOT NULL AND so.is_off = false
                     AND so.start_time <= v_start_time_of_day
                     AND so.end_time >= v_end_time_of_day)
                    OR
                    (so.id IS NULL AND es.id IS NOT NULL
                     AND es.start_time <= v_start_time_of_day
                     AND es.end_time >= v_end_time_of_day)
                )
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

-- ═══════════════════════════════════════════════════════════════
-- FIX #2: check_coverage_gaps() — add shift_overrides support
-- ═══════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS check_coverage_gaps(UUID, DATE, DATE);

CREATE OR REPLACE FUNCTION check_coverage_gaps(
    p_tenant_id UUID,
    p_start_date DATE DEFAULT CURRENT_DATE,
    p_end_date DATE DEFAULT CURRENT_DATE + 6
) RETURNS TABLE (
    service_id UUID,
    service_name TEXT,
    check_date DATE,
    gap_hours INTEGER[],
    covered_hours INTEGER[],
    total_open_hours INTEGER,
    coverage_pct NUMERIC,
    status TEXT,
    details JSONB
) AS $$
BEGIN
    RETURN QUERY
    WITH tenant_services AS (
        SELECT s.id AS sid, s.name AS sname
        FROM services s
        WHERE s.tenant_id = p_tenant_id
    ),
    date_series AS (
        SELECT d::DATE AS check_date, EXTRACT(DOW FROM d)::INTEGER AS dow
        FROM generate_series(p_start_date, p_end_date, '1 day'::INTERVAL) AS d
    ),
    -- FIX #2: Check shift_overrides first, fall back to employee_shifts pattern
    hourly_coverage AS (
        SELECT
            ts.sid,
            ds.check_date,
            ds.dow,
            h.hr,
            CASE WHEN EXISTS (
                SELECT 1
                FROM service_employee se
                JOIN employees e ON e.id = se.employee_id
                LEFT JOIN shift_overrides so
                    ON so.employee_id = e.id
                    AND so.tenant_id = p_tenant_id
                    AND so.shift_date = ds.check_date
                LEFT JOIN employee_shifts es
                    ON es.employee_id = e.id
                    AND es.day_of_week = ds.dow
                    AND es.is_active = true
                    AND so.id IS NULL  -- only use pattern when no override
                WHERE se.service_id = ts.sid
                  AND e.tenant_id = p_tenant_id
                  AND e.is_active = true
                  AND (e.is_deleted IS NULL OR e.is_deleted = false)
                  AND (
                      -- Override exists and employee is working
                      (so.id IS NOT NULL AND so.is_off = false
                       AND so.start_time <= make_time(h.hr, 0, 0)
                       AND so.end_time > make_time(h.hr, 0, 0))
                      OR
                      -- No override, use pattern
                      (so.id IS NULL AND es.id IS NOT NULL
                       AND es.start_time <= make_time(h.hr, 0, 0)
                       AND es.end_time > make_time(h.hr, 0, 0))
                  )
            ) THEN true ELSE false END AS is_covered
        FROM tenant_services ts
        CROSS JOIN date_series ds
        CROSS JOIN generate_series(0, 23) AS h(hr)
    ),
    -- FIX #2: open_hours also respects shift_overrides
    open_hours AS (
        SELECT
            ds.check_date,
            ds.dow,
            h.hr
        FROM date_series ds
        CROSS JOIN generate_series(0, 23) AS h(hr)
        WHERE EXISTS (
            SELECT 1 FROM employees e
            LEFT JOIN shift_overrides so
                ON so.employee_id = e.id
                AND so.tenant_id = p_tenant_id
                AND so.shift_date = ds.check_date
            LEFT JOIN employee_shifts es
                ON es.employee_id = e.id
                AND es.day_of_week = ds.dow
                AND es.is_active = true
                AND so.id IS NULL
            WHERE e.tenant_id = p_tenant_id
              AND e.is_active = true
              AND (e.is_deleted IS NULL OR e.is_deleted = false)
              AND (
                  (so.id IS NOT NULL AND so.is_off = false
                   AND so.start_time <= make_time(h.hr, 0, 0)
                   AND so.end_time > make_time(h.hr, 0, 0))
                  OR
                  (so.id IS NULL AND es.id IS NOT NULL
                   AND es.start_time <= make_time(h.hr, 0, 0)
                   AND es.end_time > make_time(h.hr, 0, 0))
              )
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
$$ LANGUAGE plpgsql STABLE;
