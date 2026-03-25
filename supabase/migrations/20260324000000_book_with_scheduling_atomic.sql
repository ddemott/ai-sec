-- Combined find-and-book RPC: one round trip for the entire scheduling flow.
-- Handles solo operators (1 resource, 0 employees) through large shops (many of each).
-- All constraint checks happen atomically in a single transaction.

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
    error_message TEXT
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
    v_duration INTERVAL;
    v_found BOOLEAN := FALSE;
    r RECORD;
BEGIN
    -- ═══════════════════════════════════════════════════════════════
    -- STEP 1: Determine booking window
    -- ═══════════════════════════════════════════════════════════════
    IF p_start_time IS NOT NULL AND p_end_time IS NOT NULL THEN
        -- Exact time specified
        v_start := p_start_time;
        v_end := p_end_time;
    ELSIF p_window_from IS NOT NULL AND p_window_to IS NOT NULL THEN
        -- Window specified — we'll find the first available slot
        v_start := p_window_from;
        -- Look up service duration if service_type provided
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
            'Either (start_time + end_time) or (window_from + window_to) required'::TEXT;
        RETURN;
    END IF;

    v_duration := (COALESCE(p_duration_minutes, 30) || ' minutes')::INTERVAL;
    v_day_of_week := EXTRACT(DOW FROM v_start AT TIME ZONE 'UTC')::INTEGER;
    v_start_time_of_day := (v_start AT TIME ZONE 'UTC')::TIME;
    v_end_time_of_day := (v_end AT TIME ZONE 'UTC')::TIME;

    -- ═══════════════════════════════════════════════════════════════
    -- STEP 2: Customer upsert (find by phone or create)
    -- ═══════════════════════════════════════════════════════════════
    SELECT id INTO v_customer_id
    FROM customers
    WHERE tenant_id = p_tenant_id AND phone = p_phone;

    IF v_customer_id IS NULL THEN
        INSERT INTO customers (tenant_id, phone, name)
        VALUES (p_tenant_id, p_phone, COALESCE(p_customer_name, 'Caller'))
        RETURNING id INTO v_customer_id;
    END IF;

    -- ═══════════════════════════════════════════════════════════════
    -- STEP 3: Find best (resource, employee) pair
    -- Single query with joins — handles:
    --   - Solo (1 resource, 0 employees → employee columns NULL)
    --   - Small shop (few resources, few employees)
    --   - Large shop (many resources, many employees)
    -- ═══════════════════════════════════════════════════════════════
    IF array_length(p_required_skills, 1) IS NOT NULL AND array_length(p_required_skills, 1) > 0 THEN
        -- MODE A: Need employee with specific skills
        FOR r IN
            SELECT
                res.id AS rid,
                res.name AS rname,
                emp.id AS eid,
                emp.name AS ename
            FROM resources res
            CROSS JOIN employees emp
            INNER JOIN employee_shifts es
                ON es.employee_id = emp.id
                AND es.day_of_week = v_day_of_week
                AND es.start_time <= v_start_time_of_day
                AND es.end_time >= v_end_time_of_day
                AND es.is_active = true
            WHERE res.tenant_id = p_tenant_id
                AND res.is_active = true
                AND emp.tenant_id = p_tenant_id
                AND emp.is_active = true
                AND (emp.is_deleted IS NULL OR emp.is_deleted = false)
                -- Capability filter (skip if empty)
                AND (array_length(p_required_capabilities, 1) IS NULL
                     OR res.capabilities @> p_required_capabilities)
                -- Skill filter
                AND emp.skills @> p_required_skills
                -- No resource overlap
                AND NOT EXISTS (
                    SELECT 1 FROM appointments a
                    WHERE a.resource_id = res.id
                    AND a.status = 'scheduled'
                    AND a.start_time < v_end AND a.end_time > v_start
                )
                -- No employee overlap
                AND NOT EXISTS (
                    SELECT 1 FROM appointments a
                    WHERE a.employee_id = emp.id
                    AND a.status = 'scheduled'
                    AND a.start_time < v_end AND a.end_time > v_start
                )
                -- Preferred resource (if specified)
                AND (p_preferred_resource_id IS NULL OR res.id = p_preferred_resource_id)
                -- Preferred employee (if specified)
                AND (p_preferred_employee_id IS NULL OR emp.id = p_preferred_employee_id::UUID)
            ORDER BY
                -- Prefer preferred resource/employee, then by name
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
        -- MODE B: Resource-only booking (no employee skills required)
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

    IF NOT v_found THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, NULL::TEXT, NULL::UUID, NULL::TEXT,
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, v_customer_id,
            'No available resource/employee combination found for the requested time'::TEXT;
        RETURN;
    END IF;

    -- ═══════════════════════════════════════════════════════════════
    -- STEP 4: Insert appointment
    -- ═══════════════════════════════════════════════════════════════
    INSERT INTO appointments (
        tenant_id, resource_id, customer_id, start_time, end_time,
        description, call_id, location, employee_id
    ) VALUES (
        p_tenant_id, v_resource_id, v_customer_id, v_start, v_end,
        p_description, p_call_id, p_location, v_employee_id
    ) RETURNING id INTO v_appointment_id;

    -- ═══════════════════════════════════════════════════════════════
    -- STEP 5: Return success with full context
    -- ═══════════════════════════════════════════════════════════════
    RETURN QUERY SELECT TRUE, v_appointment_id, v_resource_id, v_resource_name,
        v_employee_id, v_employee_name, v_start, v_end, v_customer_id, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;
