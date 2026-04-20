-- Shift overrides: date-specific schedule entries that override the weekly pattern
-- Enables variable schedules where this week might differ from next week

-- ═══════════════════════════════════════════════════════════════
-- TABLE: shift_overrides
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS shift_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    shift_date DATE NOT NULL,
    start_time TIME,          -- NULL when is_off = true
    end_time TIME,            -- NULL when is_off = true
    is_off BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, employee_id, shift_date)
);

ALTER TABLE shift_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_overrides FORCE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for shift_overrides" ON shift_overrides
    FOR ALL USING (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::UUID);

-- Admin bypass for cross-tenant operations
CREATE POLICY "Admin bypass for shift_overrides" ON shift_overrides
    FOR ALL USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '');

CREATE INDEX idx_shift_overrides_employee_date ON shift_overrides(employee_id, shift_date);
CREATE INDEX idx_shift_overrides_tenant_date ON shift_overrides(tenant_id, shift_date);

-- ═══════════════════════════════════════════════════════════════
-- RPC: get_effective_shifts
-- Returns the merged view of patterns + overrides for a date range
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_effective_shifts(
    p_tenant_id UUID,
    p_employee_id UUID,
    p_start_date DATE,
    p_end_date DATE
) RETURNS TABLE (
    shift_date DATE,
    day_of_week INTEGER,
    start_time TIME,
    end_time TIME,
    is_override BOOLEAN,
    is_off BOOLEAN,
    override_id UUID
) AS $$
BEGIN
    RETURN QUERY
    WITH date_series AS (
        SELECT d::DATE AS dt, EXTRACT(DOW FROM d)::INTEGER AS dow
        FROM generate_series(p_start_date, p_end_date, '1 day'::INTERVAL) AS d
    ),
    overrides AS (
        SELECT so.shift_date AS o_date, so.start_time AS o_start, so.end_time AS o_end,
               so.is_off AS o_is_off, so.id AS o_id
        FROM shift_overrides so
        WHERE so.tenant_id = p_tenant_id
          AND so.employee_id = p_employee_id
          AND so.shift_date BETWEEN p_start_date AND p_end_date
    ),
    patterns AS (
        SELECT es.day_of_week AS p_dow, es.start_time AS p_start, es.end_time AS p_end
        FROM employee_shifts es
        WHERE es.tenant_id = p_tenant_id
          AND es.employee_id::TEXT = p_employee_id::TEXT
          AND es.is_active = true
    )
    SELECT
        ds.dt,
        ds.dow,
        COALESCE(o.o_start, p.p_start) AS start_time,
        COALESCE(o.o_end, p.p_end) AS end_time,
        (o.o_id IS NOT NULL) AS is_override,
        COALESCE(o.o_is_off, false) AS is_off,
        o.o_id AS override_id
    FROM date_series ds
    LEFT JOIN overrides o ON o.o_date = ds.dt
    LEFT JOIN patterns p ON p.p_dow = ds.dow AND o.o_id IS NULL
    WHERE o.o_id IS NOT NULL OR p.p_start IS NOT NULL
    ORDER BY ds.dt;
END;
$$ LANGUAGE plpgsql STABLE;

-- ═══════════════════════════════════════════════════════════════
-- UPDATE: book_with_scheduling_atomic
-- Check shift_overrides first, then fall back to employee_shifts
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
    -- Uses shift_overrides first, then falls back to employee_shifts pattern
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
                AND so.id IS NULL  -- only use pattern when no override
            WHERE res.tenant_id = p_tenant_id
                AND res.is_active = true
                AND emp.tenant_id = p_tenant_id
                AND emp.is_active = true
                AND (emp.is_deleted IS NULL OR emp.is_deleted = false)
                AND (array_length(p_required_capabilities, 1) IS NULL
                     OR res.capabilities @> p_required_capabilities)
                AND emp.skills @> p_required_skills
                -- Employee must be on shift (override or pattern)
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

COMMENT ON FUNCTION book_with_scheduling_atomic IS
'Atomic booking with scheduling. Checks shift_overrides first, then falls back to employee_shifts pattern.
Error codes: TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED, NO_AVAILABILITY, INVALID_PARAMS';
