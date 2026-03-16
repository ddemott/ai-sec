-- BUG-015: Migrate services and employees from SERIAL to UUID
-- This is a breaking migration that converts integer PKs to UUIDs
-- for consistency with the rest of the schema.

BEGIN;

-- ============================================================
-- Step 1: Add new UUID columns to services and employees
-- ============================================================
ALTER TABLE services ADD COLUMN IF NOT EXISTS new_id UUID DEFAULT gen_random_uuid();
ALTER TABLE employees ADD COLUMN IF NOT EXISTS new_id UUID DEFAULT gen_random_uuid();

-- Populate new_id for any existing rows that don't have one
UPDATE services SET new_id = gen_random_uuid() WHERE new_id IS NULL;
UPDATE employees SET new_id = gen_random_uuid() WHERE new_id IS NULL;

-- ============================================================
-- Step 2: Add new UUID FK columns to referencing tables
-- ============================================================
ALTER TABLE service_employee ADD COLUMN IF NOT EXISTS new_service_id UUID;
ALTER TABLE service_employee ADD COLUMN IF NOT EXISTS new_employee_id UUID;
ALTER TABLE service_resource ADD COLUMN IF NOT EXISTS new_service_id UUID;
ALTER TABLE employee_shifts ADD COLUMN IF NOT EXISTS new_employee_id UUID;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS new_employee_id UUID;

-- ============================================================
-- Step 3: Populate new FK columns from old integer columns
-- ============================================================
UPDATE service_employee se SET new_service_id = s.new_id
FROM services s WHERE s.id = se.service_id AND se.new_service_id IS NULL;

UPDATE service_employee se SET new_employee_id = e.new_id
FROM employees e WHERE e.id = se.employee_id AND se.new_employee_id IS NULL;

UPDATE service_resource sr SET new_service_id = s.new_id
FROM services s WHERE s.id = sr.service_id AND sr.new_service_id IS NULL;

UPDATE employee_shifts es SET new_employee_id = e.new_id
FROM employees e WHERE e.id = es.employee_id AND es.new_employee_id IS NULL;

UPDATE appointments a SET new_employee_id = e.new_id
FROM employees e WHERE e.id = a.employee_id AND a.new_employee_id IS NULL AND a.employee_id IS NOT NULL;

-- ============================================================
-- Step 4: Drop old FK constraints and columns, rename new ones
-- ============================================================

-- service_employee: drop old PKs/FKs, set new ones
ALTER TABLE service_employee DROP CONSTRAINT IF EXISTS service_employee_pkey;
ALTER TABLE service_employee DROP CONSTRAINT IF EXISTS service_employee_service_id_fkey;
ALTER TABLE service_employee DROP CONSTRAINT IF EXISTS service_employee_employee_id_fkey;
ALTER TABLE service_employee DROP COLUMN IF EXISTS service_id;
ALTER TABLE service_employee DROP COLUMN IF EXISTS employee_id;
ALTER TABLE service_employee RENAME COLUMN new_service_id TO service_id;
ALTER TABLE service_employee RENAME COLUMN new_employee_id TO employee_id;

-- service_resource: drop old FK, set new
ALTER TABLE service_resource DROP CONSTRAINT IF EXISTS service_resource_pkey;
ALTER TABLE service_resource DROP CONSTRAINT IF EXISTS service_resource_service_id_fkey;
ALTER TABLE service_resource DROP COLUMN IF EXISTS service_id;
ALTER TABLE service_resource RENAME COLUMN new_service_id TO service_id;

-- employee_shifts: drop old FK, set new
ALTER TABLE employee_shifts DROP CONSTRAINT IF EXISTS employee_shifts_employee_id_fkey;
ALTER TABLE employee_shifts DROP COLUMN IF EXISTS employee_id;
ALTER TABLE employee_shifts RENAME COLUMN new_employee_id TO employee_id;

-- appointments: drop old FK, set new
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_employee_id_fkey;
ALTER TABLE appointments DROP COLUMN IF EXISTS employee_id;
ALTER TABLE appointments RENAME COLUMN new_employee_id TO employee_id;

-- ============================================================
-- Step 5: Convert services and employees PKs to UUID
-- ============================================================
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_pkey;
ALTER TABLE services DROP COLUMN id;
ALTER TABLE services RENAME COLUMN new_id TO id;
ALTER TABLE services ADD PRIMARY KEY (id);

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_pkey;
ALTER TABLE employees DROP COLUMN id;
ALTER TABLE employees RENAME COLUMN new_id TO id;
ALTER TABLE employees ADD PRIMARY KEY (id);

-- ============================================================
-- Step 6: Re-add FK constraints with new UUID columns
-- ============================================================
ALTER TABLE service_employee ADD CONSTRAINT service_employee_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;
ALTER TABLE service_employee ADD CONSTRAINT service_employee_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE service_employee ADD PRIMARY KEY (service_id, employee_id);

ALTER TABLE service_resource ADD CONSTRAINT service_resource_service_id_fkey
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;
-- Re-add composite PK for service_resource
ALTER TABLE service_resource ADD PRIMARY KEY (service_id, resource_id);

ALTER TABLE employee_shifts ADD CONSTRAINT employee_shifts_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE appointments ADD CONSTRAINT appointments_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL;

-- ============================================================
-- Step 7: Update book_appointment_atomic to use UUID employees
-- ============================================================
DROP FUNCTION IF EXISTS book_appointment_atomic(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT);
CREATE OR REPLACE FUNCTION book_appointment_atomic(
    p_tenant_id UUID,
    p_resource_id UUID,
    p_customer_id UUID DEFAULT NULL,
    p_start_time TIMESTAMPTZ DEFAULT NULL,
    p_end_time TIMESTAMPTZ DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_call_id TEXT DEFAULT NULL,
    p_location TEXT DEFAULT NULL,
    p_assignment_id TEXT DEFAULT NULL,
    p_service_id UUID DEFAULT NULL,
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

    -- Parse p_assignment_id: now all IDs are UUIDs
    -- Check employees table first, then users table
    IF p_assignment_id IS NOT NULL AND p_assignment_id <> '' THEN
        IF NOT is_uuid(p_assignment_id) THEN
            RETURN QUERY SELECT FALSE, NULL::UUID,
                ('Invalid assignment_id format: must be a UUID, got "' || p_assignment_id || '"')::TEXT;
            RETURN;
        END IF;

        -- Check if it's an employee
        IF EXISTS (SELECT 1 FROM employees WHERE id = p_assignment_id::UUID AND tenant_id = p_tenant_id) THEN
            v_employee_id := p_assignment_id::UUID;
        -- Otherwise check if it's a user
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

    -- Resource Overlap Check
    SELECT EXISTS (
        SELECT 1 FROM appointments
        WHERE resource_id = p_resource_id AND status = 'scheduled'
        AND start_time < v_effective_end AND end_time > p_start_time
    ) INTO v_overlap_exists;
    IF v_overlap_exists THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, 'Resource slot already booked'::TEXT;
        RETURN;
    END IF;

    -- Employee/User Logic
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

        -- DST-safe shift check
        v_start_local := p_start_time AT TIME ZONE v_tenant_tz;
        v_end_local := v_effective_end AT TIME ZONE v_tenant_tz;
        IF NOT EXISTS (
            SELECT 1 FROM employee_shifts
            WHERE employee_id = v_employee_id
              AND day_of_week = EXTRACT(DOW FROM v_start_local)::INTEGER
              AND start_time <= v_start_local::TIME
              AND end_time >= v_end_local::TIME
              AND is_active = true
        ) THEN
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
            RETURN QUERY SELECT FALSE, NULL::UUID, 'Staff member (user) already booked'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- Insert
    INSERT INTO appointments (
        tenant_id, resource_id, customer_id, start_time, end_time, description, call_id, location, employee_id, assigned_to_user_id
    ) VALUES (
        p_tenant_id, p_resource_id, v_actual_customer_id, p_start_time, v_effective_end, p_description, p_call_id, p_location, v_employee_id, v_user_id
    ) RETURNING id INTO v_new_appointment_id;

    RETURN QUERY SELECT TRUE, v_new_appointment_id, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Step 8: Update audit trigger (employee_id column type changed)
-- The trigger function uses to_jsonb(NEW/OLD) so it adapts automatically.
-- ============================================================

-- Drop and re-create the employees active index with the new UUID type
DROP INDEX IF EXISTS idx_employees_active;
CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(tenant_id) WHERE is_deleted = false;

COMMIT;
