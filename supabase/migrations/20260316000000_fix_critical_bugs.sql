-- Migration: Fix critical bugs BUG-001, BUG-002, BUG-006
-- BUG-001: Shift timezone bug (used hardcoded UTC instead of tenant timezone)
-- BUG-002: users.email globally unique instead of per-tenant
-- BUG-006: RLS context variable inconsistency (users table still used JWT claim)

-- ============================================================
-- BUG-002: Change users.email from globally unique to per-tenant unique
-- ============================================================
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users ADD CONSTRAINT users_email_tenant_unique UNIQUE (tenant_id, email);

-- ============================================================
-- BUG-006: Standardize users RLS policy to use app.current_tenant_id
-- ============================================================
DROP POLICY IF EXISTS user_isolation_users ON users;
CREATE POLICY user_isolation_users ON users
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- Also fix set_tenant_context to only set the canonical variable
-- (the dual-set was a band-aid; standardize on app.current_tenant_id)
CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id UUID)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', p_tenant_id::TEXT, FALSE);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- BUG-001: Fix shift timezone bug in book_appointment_atomic
-- Use tenant timezone instead of hardcoded UTC for shift validation
-- ============================================================
CREATE OR REPLACE FUNCTION book_appointment_atomic(
    p_tenant_id UUID,
    p_resource_id UUID,
    p_customer_id UUID,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_description TEXT,
    p_call_id TEXT,
    p_location TEXT DEFAULT NULL,
    p_assignment_id TEXT DEFAULT NULL
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
BEGIN
    -- 0. Get tenant timezone (default to UTC if not set)
    SELECT COALESCE(t.timezone, 'UTC') INTO v_tenant_tz
    FROM tenants t WHERE t.id = p_tenant_id;

    IF v_tenant_tz IS NULL THEN
        v_tenant_tz := 'UTC';
    END IF;

    -- 1. Parse p_assignment_id
    IF p_assignment_id IS NOT NULL AND p_assignment_id <> '' THEN
        IF is_uuid(p_assignment_id) THEN
            v_user_id := p_assignment_id::UUID;
        ELSE
            v_employee_id := p_assignment_id::INTEGER;
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

        -- B. Shift Check (FIXED: use tenant timezone instead of UTC)
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
        p_tenant_id, p_resource_id, p_customer_id, p_start_time, p_end_time, p_description, p_call_id, p_location, v_employee_id, v_user_id
    ) RETURNING id INTO v_new_appointment_id;

    RETURN QUERY SELECT TRUE, v_new_appointment_id, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;
