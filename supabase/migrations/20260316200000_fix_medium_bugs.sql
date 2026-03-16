-- Migration: Fix medium-priority bugs
-- BUG-013: Soft reservations cleanup
-- BUG-014: Polymorphic p_assignment_id error handling
-- BUG-022: full_name ↔ first_name/last_name sync trigger
-- BUG-023: Name splitting fix for 3+ word names
-- BUG-046: DST-safe shift validation

-- ============================================================
-- BUG-013: Purge expired soft reservations
-- Creates a function callable via pg_cron or application-level cleanup
-- ============================================================
CREATE OR REPLACE FUNCTION purge_expired_soft_reservations()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM soft_reservations WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- If pg_cron is available, schedule every 5 minutes (otherwise call via API)
-- DO $$
-- BEGIN
--   PERFORM cron.schedule('purge-expired-soft-reservations', '*/5 * * * *', 'SELECT purge_expired_soft_reservations()');
-- EXCEPTION WHEN undefined_object THEN
--   RAISE NOTICE 'pg_cron not available — call purge_expired_soft_reservations() from application code instead';
-- END;
-- $$;

-- ============================================================
-- BUG-022: Trigger to keep full_name ↔ first_name/last_name in sync
-- ============================================================
CREATE OR REPLACE FUNCTION sync_user_names()
RETURNS TRIGGER AS $$
BEGIN
    -- If full_name changed, update first/last
    IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
        NEW.first_name := split_part(NEW.full_name, ' ', 1);
        NEW.last_name := CASE
            WHEN position(' ' in NEW.full_name) > 0
            THEN substring(NEW.full_name from position(' ' in reverse(NEW.full_name)) + 1)
            ELSE NULL
        END;
        -- BUG-023: For 3+ word names, last_name = everything after first space
        NEW.last_name := CASE
            WHEN position(' ' in NEW.full_name) > 0
            THEN substring(NEW.full_name from position(' ' in NEW.full_name) + 1)
            ELSE NULL
        END;
    -- If first/last changed, update full_name
    ELSIF NEW.first_name IS DISTINCT FROM OLD.first_name OR NEW.last_name IS DISTINCT FROM OLD.last_name THEN
        NEW.full_name := trim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_user_names ON users;
CREATE TRIGGER trg_sync_user_names
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION sync_user_names();

-- Also sync customer names
CREATE OR REPLACE FUNCTION sync_customer_names()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.name IS DISTINCT FROM OLD.name AND (NEW.first_name IS NOT DISTINCT FROM OLD.first_name AND NEW.last_name IS NOT DISTINCT FROM OLD.last_name) THEN
        NEW.first_name := split_part(NEW.name, ' ', 1);
        NEW.last_name := CASE
            WHEN position(' ' in NEW.name) > 0
            THEN substring(NEW.name from position(' ' in NEW.name) + 1)
            ELSE NULL
        END;
    ELSIF (NEW.first_name IS DISTINCT FROM OLD.first_name OR NEW.last_name IS DISTINCT FROM OLD.last_name) AND NEW.name IS NOT DISTINCT FROM OLD.name THEN
        NEW.name := trim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, ''));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_customer_names ON customers;
CREATE TRIGGER trg_sync_customer_names
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION sync_customer_names();

-- ============================================================
-- BUG-014: Error on malformed p_assignment_id
-- BUG-046: DST-safe shift validation
-- Recreate book_appointment_atomic with both fixes
-- ============================================================
DROP FUNCTION IF EXISTS book_appointment_atomic(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT);
CREATE OR REPLACE FUNCTION book_appointment_atomic(
    p_tenant_id UUID,
    p_resource_id UUID,
    p_customer_id UUID,
    p_start_time TIMESTAMPTZ,
    p_end_time TIMESTAMPTZ,
    p_description TEXT,
    p_call_id TEXT,
    p_location TEXT DEFAULT NULL,
    p_assignment_id TEXT DEFAULT NULL,
    p_service_id INTEGER DEFAULT NULL,
    p_customer_phone TEXT DEFAULT NULL,
    p_customer_name TEXT DEFAULT NULL
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
    v_actual_customer_id UUID;
    v_required_skills TEXT[];
    v_required_resources TEXT[];
    v_resource_caps TEXT[];
    v_employee_skills TEXT[];
    v_start_local TIMESTAMP;
    v_end_local TIMESTAMP;
BEGIN
    -- 0. Get tenant timezone (default to UTC if not set)
    SELECT COALESCE(t.timezone, 'UTC') INTO v_tenant_tz
    FROM tenants t WHERE t.id = p_tenant_id;

    IF v_tenant_tz IS NULL THEN
        v_tenant_tz := 'UTC';
    END IF;

    -- 0b. BUG-027: Customer upsert if phone provided but no customer_id
    IF p_customer_id IS NULL AND p_customer_phone IS NOT NULL THEN
        SELECT id INTO v_actual_customer_id
        FROM customers
        WHERE tenant_id = p_tenant_id AND phone = p_customer_phone
        LIMIT 1;

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

    -- 1. Parse p_assignment_id (BUG-014: error on malformed input)
    IF p_assignment_id IS NOT NULL AND p_assignment_id <> '' THEN
        IF is_uuid(p_assignment_id) THEN
            v_user_id := p_assignment_id::UUID;
        ELSIF p_assignment_id ~ '^\d+$' THEN
            v_employee_id := p_assignment_id::INTEGER;
        ELSE
            RETURN QUERY SELECT FALSE, NULL::UUID,
                ('Invalid assignment_id format: must be a UUID or integer, got "' || p_assignment_id || '"')::TEXT;
            RETURN;
        END IF;
    END IF;

    -- 1b. BUG-009: Validate service requirements if service_id provided
    IF p_service_id IS NOT NULL THEN
        SELECT s.required_skills, s.required_resources
        INTO v_required_skills, v_required_resources
        FROM services s
        WHERE s.id = p_service_id AND s.tenant_id = p_tenant_id;

        IF v_required_resources IS NOT NULL AND array_length(v_required_resources, 1) > 0 THEN
            SELECT COALESCE(r.capabilities, '{}')
            INTO v_resource_caps
            FROM resources r
            WHERE r.id = p_resource_id;

            IF NOT v_required_resources <@ v_resource_caps THEN
                RETURN QUERY SELECT FALSE, NULL::UUID,
                    'Resource does not have required capabilities for this service'::TEXT;
                RETURN;
            END IF;
        END IF;

        IF v_employee_id IS NOT NULL AND v_required_skills IS NOT NULL AND array_length(v_required_skills, 1) > 0 THEN
            SELECT COALESCE(e.skills, '{}')
            INTO v_employee_skills
            FROM employees e
            WHERE e.id = v_employee_id AND e.tenant_id = p_tenant_id;

            IF NOT v_required_skills <@ v_employee_skills THEN
                RETURN QUERY SELECT FALSE, NULL::UUID,
                    'Employee does not have required skills for this service'::TEXT;
                RETURN;
            END IF;
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

        -- B. BUG-046: DST-safe shift check
        -- Convert to local time once and reuse (handles DST transitions correctly
        -- because AT TIME ZONE with TIMESTAMPTZ accounts for the zone's DST rules at that instant)
        v_start_local := p_start_time AT TIME ZONE v_tenant_tz;
        v_end_local := p_end_time AT TIME ZONE v_tenant_tz;

        IF NOT EXISTS (
            SELECT 1 FROM employee_shifts
            WHERE employee_id = v_employee_id
              AND day_of_week = EXTRACT(DOW FROM v_start_local)::INTEGER
              AND start_time <= v_start_local::TIME
              AND end_time >= v_end_local::TIME
              AND is_active = true
        ) THEN
            -- Check if appointment spans midnight (crosses day boundary)
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
        p_tenant_id, p_resource_id, v_actual_customer_id, p_start_time, p_end_time, p_description, p_call_id, p_location, v_employee_id, v_user_id
    ) RETURNING id INTO v_new_appointment_id;

    RETURN QUERY SELECT TRUE, v_new_appointment_id, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;
