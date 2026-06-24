--
-- PostgreSQL database dump
--

\restrict dwx9xdbj36z5heMaJXHoyyaNYSchPt8VS9bc2aUDwg2eVtW59sZV3z5srPuiGwV

-- Dumped from database version 15.4 (Debian 15.4-2.pgdg120+1)
-- Dumped by pg_dump version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: add_customer_note(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_customer_note(p_customer_id uuid, p_note text, p_note_type text DEFAULT 'general'::text, p_call_id text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_note JSONB;
BEGIN
    v_note := jsonb_build_object(
        'id', gen_random_uuid(),
        'text', p_note,
        'type', p_note_type,
        'call_id', p_call_id,
        'created_at', now()
    );

    UPDATE customers
    SET metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{notes}',
        COALESCE(metadata->'notes', '[]'::jsonb) || v_note
    ),
    updated_at = now()
    WHERE id = p_customer_id;

    RETURN FOUND;
END;
$$;


--
-- Name: apply_business_template_defaults(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_business_template_defaults() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_template business_templates%ROWTYPE;
BEGIN
    -- Look up the template for the business type
    SELECT * INTO v_template FROM business_templates WHERE business_type = NEW.business_type;
    
    -- If template exists, apply defaults to the tenant if they are NULL
    IF FOUND THEN
        IF NEW.system_prompt IS NULL THEN
            -- Replace {{business_name}} placeholder with actual business name
            NEW.system_prompt := REPLACE(v_template.system_prompt_template, '{{business_name}}', NEW.name);
        END IF;
        
        IF NEW.voice_id IS NULL THEN
            NEW.voice_id := v_template.voice_id;
        END IF;

        IF NEW.first_message IS NULL THEN
            NEW.first_message := v_template.first_message;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: auto_version_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_version_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
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
$$;


--
-- Name: book_appointment_atomic(uuid, uuid, uuid, timestamp with time zone, timestamp with time zone, text, text, text, text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.book_appointment_atomic(p_tenant_id uuid, p_resource_id uuid, p_customer_id uuid DEFAULT NULL::uuid, p_start_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_description text DEFAULT NULL::text, p_call_id text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_assignment_id text DEFAULT NULL::text, p_service_id uuid DEFAULT NULL::uuid, p_customer_phone text DEFAULT NULL::text, p_customer_name text DEFAULT NULL::text) RETURNS TABLE(success boolean, appointment_id uuid, error_message text)
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: FUNCTION book_appointment_atomic(p_tenant_id uuid, p_resource_id uuid, p_customer_id uuid, p_start_time timestamp with time zone, p_end_time timestamp with time zone, p_description text, p_call_id text, p_location text, p_assignment_id text, p_service_id uuid, p_customer_phone text, p_customer_name text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.book_appointment_atomic(p_tenant_id uuid, p_resource_id uuid, p_customer_id uuid, p_start_time timestamp with time zone, p_end_time timestamp with time zone, p_description text, p_call_id text, p_location text, p_assignment_id text, p_service_id uuid, p_customer_phone text, p_customer_name text) IS 'Atomic appointment booking with full alignment enforcement.
When p_service_id is provided, prefers the service_employee /
service_resource mapping tables as the source of truth for who/what
can perform the service; falls back to services.required_skills /
required_resources arrays only when the mapping table has no rows
for that service (open-service semantic).
Concurrency-safe via appointments_no_resource_overlap +
appointments_no_employee_overlap exclusion constraints — race losers
are translated back to "already booked" by the EXCEPTION handler.';


--
-- Name: book_with_scheduling_atomic(uuid, text, text, text, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, text[], text[], uuid, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.book_with_scheduling_atomic(p_tenant_id uuid, p_phone text, p_customer_name text DEFAULT NULL::text, p_description text DEFAULT 'Booking via SecretaryHQ'::text, p_call_id text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_start_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_window_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_window_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_required_skills text[] DEFAULT '{}'::text[], p_required_capabilities text[] DEFAULT '{}'::text[], p_preferred_resource_id uuid DEFAULT NULL::uuid, p_preferred_employee_id text DEFAULT NULL::text, p_service_type text DEFAULT NULL::text, p_duration_minutes integer DEFAULT 30) RETURNS TABLE(success boolean, appointment_id uuid, resource_id uuid, resource_name text, employee_id uuid, employee_name text, booked_start timestamp with time zone, booked_end timestamp with time zone, customer_id uuid, error_message text, error_code text)
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: FUNCTION book_with_scheduling_atomic(p_tenant_id uuid, p_phone text, p_customer_name text, p_description text, p_call_id text, p_location text, p_start_time timestamp with time zone, p_end_time timestamp with time zone, p_window_from timestamp with time zone, p_window_to timestamp with time zone, p_required_skills text[], p_required_capabilities text[], p_preferred_resource_id uuid, p_preferred_employee_id text, p_service_type text, p_duration_minutes integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.book_with_scheduling_atomic(p_tenant_id uuid, p_phone text, p_customer_name text, p_description text, p_call_id text, p_location text, p_start_time timestamp with time zone, p_end_time timestamp with time zone, p_window_from timestamp with time zone, p_window_to timestamp with time zone, p_required_skills text[], p_required_capabilities text[], p_preferred_resource_id uuid, p_preferred_employee_id text, p_service_type text, p_duration_minutes integer) IS 'Atomic booking with scheduling. Uses employee_schedule (date-based) for shift validation.
Concurrency-safe via appointments_no_resource_overlap / appointments_no_employee_overlap
exclusion constraints — race losers receive TIMESLOT_OCCUPIED.
Error codes: TIMESLOT_OCCUPIED, NO_SKILLED_EMPLOYEE, EMPLOYEE_NOT_SCHEDULED, NO_AVAILABILITY, INVALID_PARAMS';


--
-- Name: check_availability_with_tz(uuid, uuid, timestamp with time zone, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_availability_with_tz(p_tenant_id uuid, p_resource_id uuid, p_start_time timestamp with time zone, p_end_time timestamp with time zone, p_customer_tz text DEFAULT NULL::text) RETURNS TABLE(available boolean, tenant_timezone text, local_start text, local_end text)
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: check_coverage_gaps(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_coverage_gaps(p_tenant_id uuid, p_start_date date DEFAULT CURRENT_DATE, p_end_date date DEFAULT (CURRENT_DATE + 6)) RETURNS TABLE(service_id uuid, service_name text, check_date date, gap_hours integer[], covered_hours integer[], total_open_hours integer, coverage_pct numeric, status text, details jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
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
                JOIN employees e ON e.employee_id = se.employee_id
                JOIN employee_schedule sch
                    ON sch.employee_id = e.employee_id
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
                ON sch.employee_id = e.employee_id
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
$$;


--
-- Name: compare_versions(uuid, text, uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compare_versions(p_tenant_id uuid, p_table_name text, p_record_id uuid, p_version_a integer, p_version_b integer) RETURNS TABLE(field_name text, value_a jsonb, value_b jsonb)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_data_a JSONB;
  v_data_b JSONB;
  v_key TEXT;
BEGIN
  -- Get both versions
  SELECT data INTO v_data_a
  FROM record_versions
  WHERE tenant_id = p_tenant_id AND table_name = p_table_name
    AND record_id = p_record_id AND version_number = p_version_a;

  SELECT data INTO v_data_b
  FROM record_versions
  WHERE tenant_id = p_tenant_id AND table_name = p_table_name
    AND record_id = p_record_id AND version_number = p_version_b;

  -- Compare all keys from both versions
  FOR v_key IN
    SELECT DISTINCT k FROM (
      SELECT jsonb_object_keys(v_data_a) AS k
      UNION
      SELECT jsonb_object_keys(v_data_b) AS k
    ) keys
  LOOP
    IF v_data_a->v_key IS DISTINCT FROM v_data_b->v_key THEN
      field_name := v_key;
      value_a := v_data_a->v_key;
      value_b := v_data_b->v_key;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;


--
-- Name: copy_fields_between_records(uuid, text, uuid, uuid, text[], text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.copy_fields_between_records(p_tenant_id uuid, p_table_name text, p_source_record_id uuid, p_target_record_id uuid, p_fields text[], p_copied_by text, p_change_source text DEFAULT 'local'::text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $_$
DECLARE
  v_source_record JSONB;
  v_target_record JSONB;
  v_new_target JSONB;
  v_field TEXT;
  v_previous_values JSONB := '{}';
  v_update_set TEXT := '';
  v_change_summary TEXT;
BEGIN
  -- Get source record (including deleted)
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE id = $1 AND tenant_id = $2',
    p_table_name
  ) INTO v_source_record USING p_source_record_id, p_tenant_id;

  IF v_source_record IS NULL THEN
    RAISE EXCEPTION 'Source record not found';
  END IF;

  -- Get target record (must not be deleted)
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE id = $1 AND tenant_id = $2 AND (is_deleted = false OR is_deleted IS NULL)',
    p_table_name
  ) INTO v_target_record USING p_target_record_id, p_tenant_id;

  IF v_target_record IS NULL THEN
    RAISE EXCEPTION 'Target record not found or is deleted';
  END IF;

  -- Build changes
  v_new_target := v_target_record;

  FOREACH v_field IN ARRAY p_fields LOOP
    IF v_field IN ('id', 'tenant_id', 'created_at') THEN
      CONTINUE;
    END IF;

    v_previous_values := v_previous_values || jsonb_build_object(v_field, v_target_record->v_field);
    v_new_target := jsonb_set(v_new_target, ARRAY[v_field], COALESCE(v_source_record->v_field, 'null'::jsonb));
  END LOOP;

  -- Build UPDATE
  SELECT string_agg(format('%I = $1->%L', f, f), ', ')
  INTO v_update_set
  FROM unnest(p_fields) AS f
  WHERE f NOT IN ('id', 'tenant_id', 'created_at');

  -- Execute update
  IF v_update_set IS NOT NULL AND v_update_set != '' THEN
    EXECUTE format(
      'UPDATE %I SET %s, updated_at = now() WHERE id = $2 AND tenant_id = $3',
      p_table_name, v_update_set
    ) USING v_new_target, p_target_record_id, p_tenant_id;
  END IF;

  -- Get final state
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE id = $1 AND tenant_id = $2',
    p_table_name
  ) INTO v_new_target USING p_target_record_id, p_tenant_id;

  -- Change summary
  v_change_summary := 'Copied ' || array_to_string(p_fields, ', ') || ' from record ' || p_source_record_id::text;

  -- Create version
  PERFORM create_record_version(
    p_tenant_id, p_table_name, p_target_record_id,
    v_new_target,
    p_fields,
    v_previous_values,
    'merge',
    p_change_source,
    p_copied_by,
    v_change_summary
  );

  RETURN v_new_target;
END;
$_$;


--
-- Name: create_default_resources(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_default_resources() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: create_record_version(uuid, text, uuid, jsonb, text[], jsonb, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_record_version(p_tenant_id uuid, p_table_name text, p_record_id uuid, p_data jsonb, p_changed_fields text[], p_previous_values jsonb, p_change_type text, p_change_source text, p_changed_by text DEFAULT NULL::text, p_change_summary text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_record_version_id UUID;
  v_version_number INT;
BEGIN
  v_version_number := get_next_version_number(p_tenant_id, p_table_name, p_record_id);

  INSERT INTO record_versions (
    tenant_id, table_name, record_id, version_number,
    data, changed_fields, previous_values,
    change_type, change_source, changed_by, change_summary
  ) VALUES (
    p_tenant_id, p_table_name, p_record_id, v_version_number,
    p_data, p_changed_fields, p_previous_values,
    p_change_type, p_change_source, p_changed_by, p_change_summary
  )
  RETURNING record_version_id INTO v_record_version_id;

  RETURN v_record_version_id;
END;
$$;


--
-- Name: end_voice_session(uuid, text, integer, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.end_voice_session(p_tenant_id uuid, p_call_id text, p_duration_seconds integer DEFAULT NULL::integer, p_outcome text DEFAULT NULL::text, p_transcript text DEFAULT NULL::text, p_summary text DEFAULT NULL::text, p_appointment_id uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    UPDATE voice_sessions
    SET
        status = 'completed',
        ended_at = now(),
        duration_seconds = COALESCE(p_duration_seconds, EXTRACT(EPOCH FROM (now() - started_at))::INTEGER),
        outcome = p_outcome,
        transcript = p_transcript,
        summary = p_summary,
        appointment_id = p_appointment_id,
        updated_at = now()
    WHERE tenant_id = p_tenant_id AND call_id = p_call_id;

    RETURN FOUND;
END;
$$;


--
-- Name: fn_audit_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_audit_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_pk_column TEXT;
  v_record_id TEXT;
BEGIN
  v_pk_column := CASE TG_TABLE_NAME
    WHEN 'resources' THEN 'resource_id'
    WHEN 'appointments' THEN 'appointment_id'
    WHEN 'customers' THEN 'customer_id'
    WHEN 'services' THEN 'service_id'
    WHEN 'employees' THEN 'employee_id'
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
$$;


--
-- Name: fn_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: generate_change_summary(text[], jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_change_summary(p_changed_fields text[], p_previous_values jsonb, p_new_values jsonb) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_summary TEXT := '';
  v_field TEXT;
  v_old_val TEXT;
  v_new_val TEXT;
BEGIN
  IF array_length(p_changed_fields, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  FOREACH v_field IN ARRAY p_changed_fields LOOP
    v_old_val := COALESCE(p_previous_values->>v_field, 'null');
    v_new_val := COALESCE(p_new_values->>v_field, 'null');

    -- Truncate long values
    IF length(v_old_val) > 50 THEN
      v_old_val := substring(v_old_val from 1 for 47) || '...';
    END IF;
    IF length(v_new_val) > 50 THEN
      v_new_val := substring(v_new_val from 1 for 47) || '...';
    END IF;

    IF v_summary != '' THEN
      v_summary := v_summary || '; ';
    END IF;
    v_summary := v_summary || v_field || ': ' || v_old_val || ' → ' || v_new_val;
  END LOOP;

  RETURN v_summary;
END;
$$;


--
-- Name: get_customer_context_for_call(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_customer_context_for_call(p_tenant_id uuid, p_phone text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_customer RECORD;
    v_context JSONB;
    v_appointments JSONB;
    v_stats RECORD;
BEGIN
    SELECT * INTO v_customer
    FROM customers
    WHERE tenant_id = p_tenant_id
    AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g')
    AND is_deleted = false
    LIMIT 1;

    IF v_customer IS NULL THEN
        RETURN jsonb_build_object(
            'is_known_customer', false,
            'customer', null,
            'appointment_history', jsonb_build_object(
                'total', 0,
                'completed', 0,
                'cancelled', 0,
                'last_appointment', null,
                'upcoming_appointments', '[]'::jsonb
            ),
            'notes', '[]'::jsonb,
            'preferences', '{}'::jsonb,
            'tags', '[]'::jsonb
        );
    END IF;

    SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'canceled') as cancelled
    INTO v_stats
    FROM appointments
    WHERE customer_id = v_customer.customer_id
    AND tenant_id = p_tenant_id;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', a.appointment_id,
            'start_time', a.start_time,
            'end_time', a.end_time,
            'status', a.status,
            'description', a.description,
            'resource_name', r.name,
            'employee_name', e.name
        ) ORDER BY a.start_time
    ), '[]'::jsonb) INTO v_appointments
    FROM appointments a
    LEFT JOIN resources r ON r.resource_id = a.resource_id
    LEFT JOIN employees e ON e.employee_id = a.employee_id
    WHERE a.customer_id = v_customer.customer_id
    AND a.tenant_id = p_tenant_id
    AND a.start_time > now()
    AND a.status = 'scheduled'
    LIMIT 5;

    v_context := jsonb_build_object(
        'is_known_customer', true,
        'customer', jsonb_build_object(
            'id', v_customer.customer_id,
            'name', v_customer.name,
            'phone', v_customer.phone,
            'email', v_customer.email,
            'address', v_customer.address,
            'created_at', v_customer.created_at
        ),
        'appointment_history', jsonb_build_object(
            'total', COALESCE(v_stats.total, 0),
            'completed', COALESCE(v_stats.completed, 0),
            'cancelled', COALESCE(v_stats.cancelled, 0),
            'upcoming_appointments', v_appointments
        ),
        'notes', COALESCE(v_customer.metadata->'notes', '[]'::jsonb),
        'preferences', COALESCE(v_customer.metadata->'preferences', '{}'::jsonb),
        'tags', COALESCE(v_customer.metadata->'tags', '[]'::jsonb),
        'member_since', v_customer.created_at
    );

    RETURN v_context;
END;
$$;


--
-- Name: get_effective_shifts(uuid, uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_effective_shifts(p_tenant_id uuid, p_employee_id uuid, p_start_date date, p_end_date date) RETURNS TABLE(shift_date date, day_of_week integer, start_time time without time zone, end_time time without time zone, is_override boolean, is_off boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        es.shift_date,
        EXTRACT(DOW FROM es.shift_date)::INTEGER AS day_of_week,
        es.start_time,
        es.end_time,
        true AS is_override,
        es.is_off
    FROM employee_schedule es
    WHERE es.tenant_id = p_tenant_id
      AND es.employee_id = p_employee_id
      AND es.shift_date BETWEEN p_start_date AND p_end_date
    ORDER BY es.shift_date;
END;
$$;


--
-- Name: get_effective_shifts_bulk(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_effective_shifts_bulk(p_tenant_id uuid, p_start_date date, p_end_date date) RETURNS TABLE(employee_id uuid, shift_date date, day_of_week integer, start_time time without time zone, end_time time without time zone, is_override boolean, is_off boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        es.employee_id,
        es.shift_date,
        EXTRACT(DOW FROM es.shift_date)::INTEGER AS day_of_week,
        es.start_time,
        es.end_time,
        true AS is_override,
        es.is_off
    FROM employee_schedule es
    WHERE es.tenant_id = p_tenant_id
      AND es.shift_date BETWEEN p_start_date AND p_end_date
    ORDER BY es.employee_id, es.shift_date;
END;
$$;


--
-- Name: get_next_version_number(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_next_version_number(p_tenant_id uuid, p_table_name text, p_record_id uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_max_version INT;
BEGIN
  SELECT COALESCE(MAX(version_number), 0) INTO v_max_version
  FROM record_versions
  WHERE tenant_id = p_tenant_id
    AND table_name = p_table_name
    AND record_id = p_record_id;

  RETURN v_max_version + 1;
END;
$$;


--
-- Name: get_record_history(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_record_history(p_tenant_id uuid, p_table_name text, p_record_id uuid) RETURNS TABLE(record_version_id uuid, version_number integer, data jsonb, changed_fields text[], previous_values jsonb, change_type text, change_source text, changed_by text, change_summary text, changed_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    rv.record_version_id,
    rv.version_number,
    rv.data,
    rv.changed_fields,
    rv.previous_values,
    rv.change_type,
    rv.change_source,
    rv.changed_by,
    rv.change_summary,
    rv.changed_at
  FROM record_versions rv
  WHERE rv.tenant_id = p_tenant_id
    AND rv.table_name = p_table_name
    AND rv.record_id = p_record_id
  ORDER BY rv.version_number DESC;
END;
$$;


--
-- Name: get_record_version(uuid, text, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_record_version(p_tenant_id uuid, p_table_name text, p_record_id uuid, p_version_number integer) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_data JSONB;
BEGIN
  SELECT data INTO v_data
  FROM record_versions
  WHERE tenant_id = p_tenant_id
    AND table_name = p_table_name
    AND record_id = p_record_id
    AND version_number = p_version_number;

  RETURN v_data;
END;
$$;


--
-- Name: is_uuid(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_uuid(p_val text) RETURNS boolean
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN p_val ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
END;
$_$;


--
-- Name: link_orphaned_transcripts(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_orphaned_transcripts(p_tenant_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_linked INTEGER := 0;
BEGIN
  -- Link transcripts that share a call_id with an appointment that has a customer
  WITH linked AS (
    UPDATE call_transcripts ct
    SET customer_id = a.customer_id
    FROM appointments a
    WHERE ct.tenant_id = p_tenant_id
      AND ct.customer_id IS NULL
      AND a.tenant_id = p_tenant_id
      AND a.call_id IS NOT NULL
      AND a.customer_id IS NOT NULL
      AND ct.call_id = a.call_id
    RETURNING ct.call_transcript_id
  )
  SELECT count(*) INTO v_linked FROM linked;

  RETURN v_linked;
END;
$$;


--
-- Name: notify_n8n_on_appointment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_n8n_on_appointment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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
$$;


--
-- Name: purge_expired_soft_reservations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_expired_soft_reservations() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM soft_reservations WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;


--
-- Name: reap_stale_voice_sessions(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reap_stale_voice_sessions(p_max_age_minutes integer DEFAULT 15) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
    v_count INTEGER;
    -- Clamp to >= 1 minute. p_max_age_minutes reaches a SECURITY DEFINER
    -- function; a 0 or negative value would push the cutoff into the future and
    -- finalize LIVE, in-progress calls. Never reap anything younger than a minute.
    v_min_age INTEGER := GREATEST(COALESCE(p_max_age_minutes, 15), 1);
BEGIN
    UPDATE voice_sessions
    SET
        status = 'completed',
        ended_at = now(),
        duration_seconds = COALESCE(
            duration_seconds,
            EXTRACT(EPOCH FROM (now() - started_at))::INTEGER
        ),
        -- Human-visible marker so the Calls tab explains WHY this row has no
        -- transcript/outcome: the agent never sent its end. Only set when blank.
        summary = COALESCE(
            NULLIF(summary, ''),
            'Auto-finalized: the call ended but the agent did not send a completion record.'
        ),
        updated_at = now()
    WHERE status = 'active'
      AND started_at < now() - make_interval(mins => v_min_age);

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
-- search_path pinned: a SECURITY DEFINER function with a mutable search_path can
-- be hijacked (an attacker-created object shadowing an unqualified name would run
-- with the definer's rights). pg_catalog first so built-ins can't be shadowed.
$$;


--
-- Name: restore_deleted_record(uuid, text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_deleted_record(p_tenant_id uuid, p_table_name text, p_record_id uuid, p_restored_by text, p_change_source text DEFAULT 'local'::text) RETURNS boolean
    LANGUAGE plpgsql
    AS $_$
DECLARE
  v_record  JSONB;
  v_pk_col  TEXT;
BEGIN
  -- Same PK lookup as soft_delete_record; see notes there.
  SELECT kcu.column_name INTO v_pk_col
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    USING (constraint_name, table_schema, table_name)
  WHERE tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name = p_table_name
  ORDER BY kcu.ordinal_position
  LIMIT 1;

  IF v_pk_col IS NULL THEN
    RETURN false;
  END IF;

  -- Snapshot the deleted row before restoring (only restores rows that
  -- are currently soft-deleted).
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE %I = $1 AND tenant_id = $2 AND is_deleted = true',
    p_table_name, v_pk_col
  ) INTO v_record USING p_record_id, p_tenant_id;

  IF v_record IS NULL THEN
    RETURN false;
  END IF;

  -- Restore.
  EXECUTE format(
    'UPDATE %I SET is_deleted = false, deleted_at = NULL, deleted_by = NULL WHERE %I = $1 AND tenant_id = $2',
    p_table_name, v_pk_col
  ) USING p_record_id, p_tenant_id;

  -- Snapshot the restored row for the version log.
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE %I = $1 AND tenant_id = $2',
    p_table_name, v_pk_col
  ) INTO v_record USING p_record_id, p_tenant_id;

  PERFORM create_record_version(
    p_tenant_id, p_table_name, p_record_id,
    v_record,
    ARRAY['is_deleted', 'deleted_at', 'deleted_by'],
    jsonb_build_object(
      'is_deleted', true,
      'deleted_at', v_record->>'deleted_at',
      'deleted_by', v_record->>'deleted_by'
    ),
    'restore',
    p_change_source,
    p_restored_by,
    'Record restored from deletion'
  );

  RETURN true;
END;
$_$;


--
-- Name: restore_fields_from_version(uuid, text, uuid, integer, text[], text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_fields_from_version(p_tenant_id uuid, p_table_name text, p_record_id uuid, p_source_version integer, p_fields text[], p_restored_by text, p_change_source text DEFAULT 'local'::text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $_$
DECLARE
  v_current_record JSONB;
  v_source_record JSONB;
  v_new_record JSONB;
  v_field TEXT;
  v_previous_values JSONB := '{}';
  v_update_set TEXT := '';
  v_change_summary TEXT := '';
BEGIN
  -- Get current record
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE id = $1 AND tenant_id = $2',
    p_table_name
  ) INTO v_current_record USING p_record_id, p_tenant_id;

  IF v_current_record IS NULL THEN
    RAISE EXCEPTION 'Record not found';
  END IF;

  -- Get source version
  SELECT data INTO v_source_record
  FROM record_versions
  WHERE tenant_id = p_tenant_id
    AND table_name = p_table_name
    AND record_id = p_record_id
    AND version_number = p_source_version;

  IF v_source_record IS NULL THEN
    RAISE EXCEPTION 'Source version not found';
  END IF;

  -- Build update statement and track changes
  v_new_record := v_current_record;

  FOREACH v_field IN ARRAY p_fields LOOP
    -- Skip system fields
    IF v_field IN ('id', 'tenant_id', 'created_at') THEN
      CONTINUE;
    END IF;

    -- Track previous value
    v_previous_values := v_previous_values || jsonb_build_object(v_field, v_current_record->v_field);

    -- Update new record
    v_new_record := jsonb_set(v_new_record, ARRAY[v_field], COALESCE(v_source_record->v_field, 'null'::jsonb));

    -- Build summary
    IF v_change_summary != '' THEN
      v_change_summary := v_change_summary || '; ';
    END IF;
    v_change_summary := v_change_summary || v_field || ' restored from v' || p_source_version;
  END LOOP;

  -- Build dynamic UPDATE statement
  SELECT string_agg(format('%I = $1->%L', f, f), ', ')
  INTO v_update_set
  FROM unnest(p_fields) AS f
  WHERE f NOT IN ('id', 'tenant_id', 'created_at');

  -- Execute update
  IF v_update_set IS NOT NULL AND v_update_set != '' THEN
    EXECUTE format(
      'UPDATE %I SET %s, updated_at = now() WHERE id = $2 AND tenant_id = $3',
      p_table_name, v_update_set
    ) USING v_new_record, p_record_id, p_tenant_id;
  END IF;

  -- Get final record state
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE id = $1 AND tenant_id = $2',
    p_table_name
  ) INTO v_new_record USING p_record_id, p_tenant_id;

  -- Create version snapshot
  PERFORM create_record_version(
    p_tenant_id, p_table_name, p_record_id,
    v_new_record,
    p_fields,
    v_previous_values,
    'restore',
    p_change_source,
    p_restored_by,
    v_change_summary
  );

  RETURN v_new_record;
END;
$_$;


--
-- Name: search_tenant_docs(uuid, public.vector, double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_tenant_docs(p_tenant_id uuid, p_query_embedding public.vector, p_match_threshold double precision, p_match_count integer) RETURNS TABLE(tenant_doc_id uuid, content text, similarity double precision)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        td.tenant_doc_id,
        td.content,
        1 - (td.embedding <=> p_query_embedding) AS similarity
    FROM tenant_docs td
    WHERE td.tenant_id = p_tenant_id
      AND 1 - (td.embedding <=> p_query_embedding) > p_match_threshold
    ORDER BY td.embedding <=> p_query_embedding
    LIMIT p_match_count;
END;
$$;


--
-- Name: search_tenant_docs_normalized(uuid, public.vector, double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_tenant_docs_normalized(p_tenant_id uuid, p_query_embedding public.vector, p_match_threshold double precision, p_match_count integer) RETURNS TABLE(tenant_doc_id uuid, content text, normalized_text text, similarity double precision)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        td.tenant_doc_id,
        td.content,
        td.normalized_text,
        1 - (td.embedding <=> p_query_embedding) AS similarity
    FROM tenant_docs td
    WHERE td.tenant_id = p_tenant_id
      AND 1 - (td.embedding <=> p_query_embedding) > p_match_threshold
    ORDER BY td.embedding <=> p_query_embedding
    LIMIT p_match_count;
END;
$$;


--
-- Name: set_tenant_context(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_tenant_context(p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', p_tenant_id::TEXT, FALSE);
END;
$$;


--
-- Name: soft_delete_record(uuid, text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.soft_delete_record(p_tenant_id uuid, p_table_name text, p_record_id uuid, p_deleted_by text, p_change_source text DEFAULT 'local'::text) RETURNS boolean
    LANGUAGE plpgsql
    AS $_$
DECLARE
  v_record  JSONB;
  v_pk_col  TEXT;
BEGIN
  -- Find the PK column for the target table. Whitelisted tables have
  -- exactly one PK column; LIMIT 1 guards against a future composite-PK
  -- entry sneaking onto the whitelist.
  SELECT kcu.column_name INTO v_pk_col
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    USING (constraint_name, table_schema, table_name)
  WHERE tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name = p_table_name
  ORDER BY kcu.ordinal_position
  LIMIT 1;

  IF v_pk_col IS NULL THEN
    -- Table doesn't exist OR has no PK. Either way, can't soft-delete it.
    RETURN false;
  END IF;

  -- Snapshot current row.
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE %I = $1 AND tenant_id = $2',
    p_table_name, v_pk_col
  ) INTO v_record USING p_record_id, p_tenant_id;

  IF v_record IS NULL THEN
    RETURN false;
  END IF;

  -- Create version snapshot before delete (no change to call shape).
  PERFORM create_record_version(
    p_tenant_id, p_table_name, p_record_id,
    v_record,
    ARRAY['is_deleted', 'deleted_at', 'deleted_by'],
    jsonb_build_object('is_deleted', false, 'deleted_at', NULL, 'deleted_by', NULL),
    'delete',
    p_change_source,
    p_deleted_by,
    'Record soft deleted'
  );

  -- Perform soft delete.
  EXECUTE format(
    'UPDATE %I SET is_deleted = true, deleted_at = now(), deleted_by = $1 WHERE %I = $2 AND tenant_id = $3',
    p_table_name, v_pk_col
  ) USING p_deleted_by, p_record_id, p_tenant_id;

  RETURN true;
END;
$_$;


--
-- Name: start_voice_session(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.start_voice_session(p_tenant_id uuid, p_call_id text, p_caller_phone text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_context JSONB;
    v_session_id UUID;
BEGIN
    -- Get customer context first
    v_context := get_customer_context_for_call(p_tenant_id, p_caller_phone);

    -- Create voice session record
    INSERT INTO voice_sessions (
        tenant_id, call_id, caller_phone, customer_context, customer_id
    )
    VALUES (
        p_tenant_id,
        p_call_id,
        p_caller_phone,
        v_context,
        (v_context->'customer'->>'id')::UUID
    )
    RETURNING voice_session_id INTO v_session_id;

    -- Return context plus session_id
    RETURN v_context || jsonb_build_object('session_id', v_session_id);
END;
$$;


--
-- Name: sync_customer_names(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_customer_names() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: sync_user_names(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_user_names() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: update_appointment_customer(uuid, uuid, timestamp with time zone, timestamp with time zone, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_appointment_customer(p_appointment_id uuid, p_tenant_id uuid, p_start_time timestamp with time zone, p_end_time timestamp with time zone, p_description text, p_location text, p_customer_name text, p_customer_phone text, p_customer_notes text) RETURNS TABLE(success boolean, error_message text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_customer_id UUID;
    v_resource_id UUID;
    v_overlap_exists BOOLEAN;
BEGIN
    SELECT customer_id, resource_id INTO v_customer_id, v_resource_id
    FROM appointments
    WHERE appointment_id = p_appointment_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Appointment not found or access denied (ID: ' || p_appointment_id || ', Tenant: ' || p_tenant_id || ')'::TEXT;
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM appointments
        WHERE resource_id = v_resource_id
        AND appointment_id <> p_appointment_id
        AND status = 'scheduled'
        AND start_time < p_end_time
        AND end_time > p_start_time
    ) INTO v_overlap_exists;

    IF v_overlap_exists THEN
        RETURN QUERY SELECT FALSE, 'New time slot overlaps with another appointment'::TEXT;
        RETURN;
    END IF;

    UPDATE appointments
    SET
        start_time = p_start_time,
        end_time = p_end_time,
        description = p_description,
        location = p_location
    WHERE appointment_id = p_appointment_id;

    UPDATE customers
    SET
        name = p_customer_name,
        first_name = NULLIF(split_part(COALESCE(p_customer_name, ''), ' ', 1), ''),
        last_name = NULLIF(
            btrim(
                CASE
                    WHEN position(' ' IN COALESCE(p_customer_name, '')) > 0
                    THEN substring(COALESCE(p_customer_name, '') FROM position(' ' IN COALESCE(p_customer_name, '')) + 1)
                    ELSE ''
                END
            ),
            ''
        ),
        phone = p_customer_phone,
        metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{notes}', to_jsonb(p_customer_notes))
    WHERE customer_id = v_customer_id AND tenant_id = p_tenant_id;

    RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$;


--
-- Name: update_appointment_customer(uuid, uuid, timestamp with time zone, timestamp with time zone, text, text, uuid, integer, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_appointment_customer(p_appointment_id uuid, p_tenant_id uuid, p_start_time timestamp with time zone, p_end_time timestamp with time zone, p_description text, p_location text, p_resource_id uuid, p_employee_id integer, p_customer_name text, p_customer_phone text, p_customer_notes text) RETURNS TABLE(success boolean, error_message text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_customer_id UUID;
    v_overlap_exists BOOLEAN;
BEGIN
    -- 1. Get current IDs and verify tenant ownership
    SELECT customer_id INTO v_customer_id
    FROM appointments
    WHERE id = p_appointment_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Appointment not found or access denied (ID: ' || p_appointment_id || ', Tenant: ' || p_tenant_id || ')'::TEXT;
        RETURN;
    END IF;

    -- 2. Check for overlapping appointments for this resource (excluding the current one)
    SELECT EXISTS (
        SELECT 1 FROM appointments
        WHERE resource_id = p_resource_id
        AND id <> p_appointment_id
        AND status = 'scheduled'
        AND start_time < p_end_time
        AND end_time > p_start_time
    ) INTO v_overlap_exists;

    IF v_overlap_exists THEN
        RETURN QUERY SELECT FALSE, 'New time slot overlaps with another appointment on this resource'::TEXT;
        RETURN;
    END IF;

    -- 3. Check for overlapping appointments for this employee (excluding the current one)
    IF p_employee_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM appointments
            WHERE employee_id = p_employee_id
            AND id <> p_appointment_id
            AND status = 'scheduled'
            AND start_time < p_end_time
            AND end_time > p_start_time
        ) INTO v_overlap_exists;

        IF v_overlap_exists THEN
            RETURN QUERY SELECT FALSE, 'New time slot overlaps with another appointment for this employee'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- 4. Update Appointment
    UPDATE appointments
    SET 
        start_time = p_start_time,
        end_time = p_end_time,
        description = p_description,
        location = p_location,
        resource_id = p_resource_id,
        employee_id = p_employee_id
    WHERE id = p_appointment_id;

    -- 5. Update Customer Metadata and Structured Name
    UPDATE customers
    SET 
            name = p_customer_name,
            first_name = NULLIF(split_part(COALESCE(p_customer_name, ''), ' ', 1), ''),
            last_name = NULLIF(
                btrim(
                    CASE
                        WHEN position(' ' IN COALESCE(p_customer_name, '')) > 0 
                        THEN substring(COALESCE(p_customer_name, '') FROM position(' ' IN COALESCE(p_customer_name, '')) + 1)
                        ELSE ''
                    END
                ),
                ''
            ),
            phone = p_customer_phone,
            metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{notes}', to_jsonb(p_customer_notes))
    WHERE id = v_customer_id AND tenant_id = p_tenant_id;

    RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$;


--
-- Name: update_appointment_customer(uuid, uuid, timestamp with time zone, timestamp with time zone, text, text, uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_appointment_customer(p_appointment_id uuid, p_tenant_id uuid, p_start_time timestamp with time zone, p_end_time timestamp with time zone, p_description text, p_location text, p_resource_id uuid, p_assignment_id text, p_customer_name text, p_customer_phone text, p_customer_notes text) RETURNS TABLE(success boolean, error_message text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_customer_id UUID;
    v_overlap_exists BOOLEAN;
    v_employee_id INTEGER := NULL;
    v_user_id UUID := NULL;
BEGIN
    -- 1. Parse p_assignment_id
    IF p_assignment_id IS NOT NULL AND p_assignment_id <> '' THEN
        IF is_uuid(p_assignment_id) THEN
            v_user_id := p_assignment_id::UUID;
        ELSE
            v_employee_id := p_assignment_id::INTEGER;
        END IF;
    END IF;

    -- 2. Verify tenant ownership
    SELECT customer_id INTO v_customer_id
    FROM appointments
    WHERE id = p_appointment_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'Appointment not found or access denied'::TEXT;
        RETURN;
    END IF;

    -- 3. Resource Overlap Check
    SELECT EXISTS (
        SELECT 1 FROM appointments
        WHERE resource_id = p_resource_id
        AND id <> p_appointment_id
        AND status = 'scheduled'
        AND start_time < p_end_time
        AND end_time > p_start_time
    ) INTO v_overlap_exists;

    IF v_overlap_exists THEN
        RETURN QUERY SELECT FALSE, 'Resource slot already booked'::TEXT;
        RETURN;
    END IF;

    -- 4. Employee Overlap Check
    IF v_employee_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM appointments
            WHERE employee_id = v_employee_id
            AND id <> p_appointment_id
            AND status = 'scheduled'
            AND start_time < p_end_time
            AND end_time > p_start_time
        ) INTO v_overlap_exists;

        IF v_overlap_exists THEN
            RETURN QUERY SELECT FALSE, 'Employee already booked'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- 5. User Overlap Check
    IF v_user_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM appointments
            WHERE assigned_to_user_id = v_user_id
            AND id <> p_appointment_id
            AND status = 'scheduled'
            AND start_time < p_end_time
            AND end_time > p_start_time
        ) INTO v_overlap_exists;

        IF v_overlap_exists THEN
            RETURN QUERY SELECT FALSE, 'Staff member (user) already booked'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- 6. Update Appointment
    UPDATE appointments
    SET 
        start_time = p_start_time,
        end_time = p_end_time,
        description = p_description,
        location = p_location,
        resource_id = p_resource_id,
        employee_id = v_employee_id,
        assigned_to_user_id = v_user_id
    WHERE id = p_appointment_id;

    -- 7. Update Customer
    UPDATE customers
    SET 
            name = p_customer_name,
            phone = p_customer_phone,
            metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{notes}', to_jsonb(p_customer_notes))
    WHERE id = v_customer_id AND tenant_id = p_tenant_id;

    RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_cost_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_cost_events (
    ai_cost_event_id integer NOT NULL,
    tenant_id uuid NOT NULL,
    call_id text,
    source text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    characters_count integer DEFAULT 0 NOT NULL,
    audio_duration_ms integer DEFAULT 0 NOT NULL,
    estimated_cost_usd numeric(12,8) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ai_cost_events FORCE ROW LEVEL SECURITY;


--
-- Name: ai_cost_events_ai_cost_event_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_cost_events_ai_cost_event_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_cost_events_ai_cost_event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_cost_events_ai_cost_event_id_seq OWNED BY public.ai_cost_events.ai_cost_event_id;


--
-- Name: appointment_sync_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointment_sync_map (
    appointment_id uuid NOT NULL,
    external_event_id text NOT NULL,
    provider text NOT NULL,
    last_synced_at timestamp with time zone DEFAULT now(),
    CONSTRAINT appointment_sync_map_provider_check CHECK ((provider = ANY (ARRAY['google'::text, 'outlook'::text])))
);

ALTER TABLE ONLY public.appointment_sync_map FORCE ROW LEVEL SECURITY;


--
-- Name: appointments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.appointments (
    appointment_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb,
    call_id text,
    created_at timestamp with time zone DEFAULT now(),
    location text,
    assigned_to_user_id uuid,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    employee_id uuid,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_by text,
    service_id uuid,
    CONSTRAINT appointments_check CHECK ((end_time > start_time)),
    CONSTRAINT appointments_end_time_15min CHECK ((((EXTRACT(minute FROM end_time))::integer = ANY (ARRAY[0, 15, 30, 45])) AND (EXTRACT(second FROM end_time) = (0)::numeric))),
    CONSTRAINT appointments_metadata_is_object CHECK (((metadata IS NULL) OR (jsonb_typeof(metadata) = 'object'::text))),
    CONSTRAINT appointments_start_time_15min CHECK ((((EXTRACT(minute FROM start_time))::integer = ANY (ARRAY[0, 15, 30, 45])) AND (EXTRACT(second FROM start_time) = (0)::numeric)))
);

ALTER TABLE ONLY public.appointments FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN appointments.service_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.appointments.service_id IS 'Optional FK to the service this appointment fulfills. Nullable for
backward-compat with rows created before 2026-05-07 (those carry the
service name in `description` only). Set to NULL on service delete so
historical appointments don''t cascade-delete.';


--
-- Name: CONSTRAINT appointments_end_time_15min ON appointments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT appointments_end_time_15min ON public.appointments IS 'All appointments must end on a 15-minute clock boundary (:00, :15, :30, :45). Enforced 2026-05-08.';


--
-- Name: CONSTRAINT appointments_start_time_15min ON appointments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT appointments_start_time_15min ON public.appointments IS 'All appointments must start on a 15-minute clock boundary (:00, :15, :30, :45). Enforced 2026-05-08.';


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    audit_log_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    table_name text NOT NULL,
    record_id text NOT NULL,
    action text NOT NULL,
    old_data jsonb,
    new_data jsonb,
    changed_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_log_action_check CHECK ((action = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);

ALTER TABLE ONLY public.audit_log FORCE ROW LEVEL SECURITY;


--
-- Name: business_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_templates (
    business_type text NOT NULL,
    display_name text NOT NULL,
    system_prompt_template text NOT NULL,
    first_message text NOT NULL,
    voice_id text,
    default_resource_name text NOT NULL,
    default_resource_description text,
    voice_provider text,
    voice_name text,
    resource_label text DEFAULT 'Resource'::text NOT NULL,
    resource_plural text DEFAULT 'Resources'::text NOT NULL,
    employee_label text DEFAULT 'Employee'::text NOT NULL,
    employee_plural text DEFAULT 'Employees'::text NOT NULL,
    booking_label text DEFAULT 'Appointment'::text NOT NULL,
    example_services text[] DEFAULT '{}'::text[],
    category text DEFAULT 'Other'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    example_resources text[] DEFAULT '{}'::text[]
);

ALTER TABLE ONLY public.business_templates FORCE ROW LEVEL SECURITY;


--
-- Name: call_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_summaries (
    call_summary_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    summary text NOT NULL,
    embedding public.vector(1536),
    call_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    normalized_text text
);

ALTER TABLE ONLY public.call_summaries FORCE ROW LEVEL SECURITY;


--
-- Name: call_transcripts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_transcripts (
    call_transcript_id uuid DEFAULT gen_random_uuid() NOT NULL,
    call_id text NOT NULL,
    tenant_id uuid NOT NULL,
    customer_id uuid,
    raw_text text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.call_transcripts FORCE ROW LEVEL SECURITY;


--
-- Name: communications_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communications_history (
    communications_history_id integer NOT NULL,
    tenant_id uuid NOT NULL,
    customer_id uuid,
    channel character varying(10) NOT NULL,
    direction character varying(10) DEFAULT 'outbound'::character varying NOT NULL,
    recipient character varying(255) NOT NULL,
    subject character varying(255),
    body text,
    status character varying(20) DEFAULT 'sent'::character varying NOT NULL,
    provider_message_id character varying(255),
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT communications_history_channel_check CHECK (((channel)::text = ANY ((ARRAY['email'::character varying, 'sms'::character varying])::text[]))),
    CONSTRAINT communications_history_direction_check CHECK (((direction)::text = ANY ((ARRAY['outbound'::character varying, 'inbound'::character varying])::text[]))),
    CONSTRAINT communications_history_status_check CHECK (((status)::text = ANY ((ARRAY['sent'::character varying, 'failed'::character varying, 'queued'::character varying])::text[])))
);

ALTER TABLE ONLY public.communications_history FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE communications_history; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.communications_history IS 'Append-only log of outbound (and optionally inbound) SMS/email communications, written on the send success path; backs GET /communications/history.';


--
-- Name: COLUMN communications_history.channel; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communications_history.channel IS 'Communication channel: email or sms';


--
-- Name: COLUMN communications_history.direction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communications_history.direction IS 'Message direction: outbound (default) or inbound';


--
-- Name: COLUMN communications_history.recipient; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communications_history.recipient IS 'Destination address (email address or E.164 phone number)';


--
-- Name: COLUMN communications_history.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communications_history.status IS 'Delivery disposition recorded at send time: sent, failed, or queued';


--
-- Name: COLUMN communications_history.provider_message_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.communications_history.provider_message_id IS 'Upstream provider message id (nodemailer messageId / Telnyx ID; legacy provider SID references in old rows) for cross-referencing';


--
-- Name: communications_history_communications_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.communications_history_communications_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: communications_history_communications_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.communications_history_communications_history_id_seq OWNED BY public.communications_history.communications_history_id;


--
-- Name: consent_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_records (
    consent_record_id integer NOT NULL,
    tenant_id uuid NOT NULL,
    customer_id uuid,
    customer_email character varying(255),
    customer_phone character varying(30),
    consent_type character varying(10) NOT NULL,
    consent_given boolean DEFAULT true NOT NULL,
    consent_date timestamp with time zone NOT NULL,
    consent_method character varying(20) NOT NULL,
    consent_source text,
    ip_address inet,
    revoked_at timestamp with time zone,
    revoke_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consent_contact_required CHECK (((customer_email IS NOT NULL) OR (customer_phone IS NOT NULL))),
    CONSTRAINT consent_records_consent_method_check CHECK (((consent_method)::text = ANY ((ARRAY['web_form'::character varying, 'sms_reply'::character varying, 'verbal'::character varying, 'import'::character varying, 'booking'::character varying])::text[]))),
    CONSTRAINT consent_records_consent_type_check CHECK (((consent_type)::text = ANY ((ARRAY['email'::character varying, 'sms'::character varying, 'both'::character varying])::text[])))
);

ALTER TABLE ONLY public.consent_records FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE consent_records; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.consent_records IS 'Customer communication consent tracking for GDPR/TCPA compliance';


--
-- Name: COLUMN consent_records.consent_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.consent_records.consent_method IS 'How consent was obtained: web_form, sms_reply, verbal, import, booking';


--
-- Name: consent_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.consent_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: consent_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.consent_records_id_seq OWNED BY public.consent_records.consent_record_id;


--
-- Name: customer_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_messages (
    message_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    customer_id uuid,
    caller_phone text,
    caller_name text NOT NULL,
    callback_phone text,
    message text NOT NULL,
    call_id text,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.customer_messages FORCE ROW LEVEL SECURITY;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    customer_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    phone text NOT NULL,
    name text,
    email text,
    address text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    first_name text,
    last_name text,
    address_line2 text,
    state text,
    postal_code text,
    city text,
    timezone text DEFAULT 'America/New_York'::text,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_by text,
    CONSTRAINT customers_metadata_is_object CHECK (((metadata IS NULL) OR (jsonb_typeof(metadata) = 'object'::text)))
);

ALTER TABLE ONLY public.customers FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN customers.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customers.metadata IS 'Customer metadata including notes array, preferences, tags, etc.';


--
-- Name: record_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.record_versions (
    record_version_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    version_number integer NOT NULL,
    data jsonb NOT NULL,
    changed_fields text[] DEFAULT '{}'::text[],
    previous_values jsonb DEFAULT '{}'::jsonb,
    change_type text NOT NULL,
    change_source text NOT NULL,
    changed_by text,
    change_summary text,
    changed_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.record_versions FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE record_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.record_versions IS 'Soft-delete + version history for tracked tables. RLS forced 2026-05-09 — same closure as voice_sessions.';


--
-- Name: deleted_customers; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.deleted_customers AS
 SELECT c.customer_id,
    c.tenant_id,
    c.phone,
    c.name,
    c.email,
    c.address,
    c.metadata,
    c.created_at,
    c.first_name,
    c.last_name,
    c.address_line2,
    c.state,
    c.postal_code,
    c.city,
    c.timezone,
    c.is_deleted,
    c.deleted_at,
    c.updated_at,
    c.deleted_by,
    ( SELECT count(*) AS count
           FROM public.record_versions rv
          WHERE ((rv.record_id = c.customer_id) AND (rv.table_name = 'customers'::text))) AS version_count
   FROM public.customers c
  WHERE (c.is_deleted = true);


--
-- Name: employee_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_schedule (
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    shift_date date NOT NULL,
    start_time time without time zone,
    end_time time without time zone,
    is_off boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.employee_schedule FORCE ROW LEVEL SECURITY;


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    skills text[],
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    employee_id uuid DEFAULT gen_random_uuid() NOT NULL,
    first_name text,
    last_name text,
    email text,
    phone text,
    deleted_by text
);

ALTER TABLE ONLY public.employees FORCE ROW LEVEL SECURITY;


--
-- Name: entity_sync_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_sync_map (
    entity_sync_map_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    provider text NOT NULL,
    entity_type text NOT NULL,
    local_id uuid NOT NULL,
    external_id text NOT NULL,
    local_updated_at timestamp with time zone,
    remote_updated_at timestamp with time zone,
    last_synced_at timestamp with time zone DEFAULT now(),
    sync_status text DEFAULT 'synced'::text,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT entity_sync_map_entity_type_check CHECK ((entity_type = ANY (ARRAY['customer'::text, 'appointment'::text]))),
    CONSTRAINT entity_sync_map_provider_check CHECK ((provider = ANY (ARRAY['jobber'::text, 'hubspot'::text, 'square'::text, 'servicetitan'::text]))),
    CONSTRAINT entity_sync_map_sync_status_check CHECK ((sync_status = ANY (ARRAY['synced'::text, 'pending'::text, 'conflict'::text, 'error'::text])))
);

ALTER TABLE ONLY public.entity_sync_map FORCE ROW LEVEL SECURITY;


--
-- Name: knowledge_suggestion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_suggestion (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    question_id text,
    question text NOT NULL,
    answer text,
    source_url text,
    confidence real,
    status text DEFAULT 'suggested'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.knowledge_suggestion FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE knowledge_suggestion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.knowledge_suggestion IS 'Staged website-extracted policy answers. Only status=confirmed rows are ingested to tenant_docs for live RAG.';


--
-- Name: message_delivery_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_delivery_status (
    message_delivery_status_id integer NOT NULL,
    message_sid text NOT NULL,
    message_status text NOT NULL,
    error_code text,
    tenant_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE message_delivery_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.message_delivery_status IS 'Latest SMS delivery status per message SID (from Telnyx or legacy provider webhooks). Non-RLS event table (webhook is tenant-exempt, writes via shared pool). Legacy provider support removed 2026-06.';


--
-- Name: COLUMN message_delivery_status.message_sid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.message_delivery_status.message_sid IS 'Provider Message SID/ID. UNIQUE -- one row per message, upserted as status advances.';


--
-- Name: COLUMN message_delivery_status.message_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.message_delivery_status.message_status IS 'Latest MessageStatus (queued|sending|sent|delivered|undelivered|failed|received).';


--
-- Name: message_delivery_status_message_delivery_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.message_delivery_status_message_delivery_status_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_delivery_status_message_delivery_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.message_delivery_status_message_delivery_status_id_seq OWNED BY public.message_delivery_status.message_delivery_status_id;


--
-- Name: opt_out_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opt_out_records (
    opt_out_record_id integer NOT NULL,
    tenant_id uuid NOT NULL,
    customer_email character varying(255),
    customer_phone character varying(30),
    opt_out_type character varying(10) NOT NULL,
    opt_out_date timestamp with time zone NOT NULL,
    opt_out_method character varying(20) NOT NULL,
    original_consent_record_id integer,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT opt_out_contact_required CHECK (((customer_email IS NOT NULL) OR (customer_phone IS NOT NULL))),
    CONSTRAINT opt_out_records_opt_out_method_check CHECK (((opt_out_method)::text = ANY ((ARRAY['stop'::character varying, 'unsubscribe'::character varying, 'web_form'::character varying, 'verbal'::character varying, 'complaint'::character varying])::text[]))),
    CONSTRAINT opt_out_records_opt_out_type_check CHECK (((opt_out_type)::text = ANY ((ARRAY['email'::character varying, 'sms'::character varying, 'both'::character varying])::text[])))
);

ALTER TABLE ONLY public.opt_out_records FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE opt_out_records; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.opt_out_records IS 'Customer opt-out (STOP/UNSUBSCRIBE) records for compliance';


--
-- Name: COLUMN opt_out_records.opt_out_method; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.opt_out_records.opt_out_method IS 'How opt-out was requested: stop (SMS), unsubscribe (email), web_form, verbal, complaint';


--
-- Name: opt_out_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.opt_out_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: opt_out_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.opt_out_records_id_seq OWNED BY public.opt_out_records.opt_out_record_id;


--
-- Name: password_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_resets (
    password_reset_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    channel text DEFAULT 'email'::text NOT NULL,
    ip text,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.password_resets FORCE ROW LEVEL SECURITY;


--
-- Name: phone_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phone_verifications (
    phone_verification_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    phone text NOT NULL,
    code_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.phone_verifications FORCE ROW LEVEL SECURITY;


--
-- Name: recent_record_changes; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.recent_record_changes AS
 SELECT rv.record_version_id,
    rv.tenant_id,
    rv.table_name,
    rv.record_id,
    rv.version_number,
    rv.change_type,
    rv.change_source,
    rv.changed_by,
    rv.change_summary,
    rv.changed_at,
    (rv.data ->> 'name'::text) AS record_name,
    (rv.data ->> 'phone'::text) AS record_phone
   FROM public.record_versions rv
  ORDER BY rv.changed_at DESC;


--
-- Name: reminder_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reminder_schedules (
    reminder_schedule_id integer NOT NULL,
    appointment_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    customer_email character varying(255),
    customer_phone character varying(30),
    reminder_type character varying(20) NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    status character varying(20) DEFAULT 'scheduled'::character varying NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone,
    CONSTRAINT reminder_schedules_reminder_type_check CHECK (((reminder_type)::text = ANY ((ARRAY['confirmation'::character varying, '72h'::character varying, '24h'::character varying, '2h'::character varying])::text[]))),
    CONSTRAINT reminder_schedules_status_check CHECK (((status)::text = ANY ((ARRAY['scheduled'::character varying, 'sent'::character varying, 'failed'::character varying, 'cancelled'::character varying])::text[])))
);

ALTER TABLE ONLY public.reminder_schedules FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE reminder_schedules; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.reminder_schedules IS 'Scheduled appointment reminders (confirmation, 72h, 24h, 2h before)';


--
-- Name: COLUMN reminder_schedules.reminder_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reminder_schedules.reminder_type IS 'Type: confirmation (immediate), 72h, 24h, or 2h before appointment';


--
-- Name: COLUMN reminder_schedules.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reminder_schedules.status IS 'Status: scheduled (pending), sent, failed, or cancelled';


--
-- Name: reminder_schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reminder_schedules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reminder_schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reminder_schedules_id_seq OWNED BY public.reminder_schedules.reminder_schedule_id;


--
-- Name: resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resources (
    resource_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    capabilities text[] DEFAULT '{}'::text[],
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_personal boolean DEFAULT false,
    deleted_by text,
    is_auto_seeded boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.resources FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN resources.capabilities; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.resources.capabilities IS 'List of skills or services this resource can handle (e.g. "cut-hair", "alignment")';


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version text NOT NULL,
    filename text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_employee; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_employee (
    tenant_id uuid NOT NULL,
    service_id uuid NOT NULL,
    employee_id uuid NOT NULL
);

ALTER TABLE ONLY public.service_employee FORCE ROW LEVEL SECURITY;


--
-- Name: service_resource; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_resource (
    resource_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    service_id uuid NOT NULL
);

ALTER TABLE ONLY public.service_resource FORCE ROW LEVEL SECURITY;


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    duration_minutes integer NOT NULL,
    required_skills text[],
    required_resources text[],
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    price numeric(10,2) DEFAULT 0.00,
    service_id uuid DEFAULT gen_random_uuid() NOT NULL,
    subtitle text DEFAULT ''::text,
    is_deleted boolean DEFAULT false,
    deleted_at timestamp with time zone,
    deleted_by text,
    is_auto_seeded boolean DEFAULT false NOT NULL
);

ALTER TABLE ONLY public.services FORCE ROW LEVEL SECURITY;


--
-- Name: soft_reservations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.soft_reservations (
    soft_reservation_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    call_id text NOT NULL
);

ALTER TABLE ONLY public.soft_reservations FORCE ROW LEVEL SECURITY;


--
-- Name: tenant_calendar_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_calendar_settings (
    tenant_id uuid NOT NULL,
    provider text NOT NULL,
    external_calendar_id text NOT NULL,
    access_token text,
    refresh_token text,
    token_expires_at timestamp with time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tenant_calendar_settings_provider_check CHECK ((provider = ANY (ARRAY['google'::text, 'outlook'::text])))
);

ALTER TABLE ONLY public.tenant_calendar_settings FORCE ROW LEVEL SECURITY;


--
-- Name: tenant_docs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_docs (
    tenant_doc_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    title text,
    section text,
    content text NOT NULL,
    source text,
    embedding public.vector(1536),
    created_at timestamp with time zone DEFAULT now(),
    normalized_text text
);

ALTER TABLE ONLY public.tenant_docs FORCE ROW LEVEL SECURITY;


--
-- Name: tenant_integration_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_integration_settings (
    tenant_id uuid NOT NULL,
    provider text NOT NULL,
    access_token text,
    refresh_token text,
    token_expires_at timestamp with time zone,
    webhook_secret text,
    settings jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    last_sync_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tenant_integration_settings_provider_check CHECK ((provider = ANY (ARRAY['jobber'::text, 'hubspot'::text, 'square'::text, 'servicetitan'::text])))
);

ALTER TABLE ONLY public.tenant_integration_settings FORCE ROW LEVEL SECURITY;


--
-- Name: tenant_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_skills (
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.tenant_skills FORCE ROW LEVEL SECURITY;


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    tenant_id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    business_type text NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    voice_id text,
    system_prompt text,
    created_at timestamp with time zone DEFAULT now(),
    n8n_webhook_url text,
    owner_phone text,
    first_message text,
    inbound_phone text,
    resource_label text,
    resource_plural text,
    employee_label text,
    employee_plural text,
    booking_label text,
    onboarding_completed boolean DEFAULT false NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    subscription_status text DEFAULT 'inactive'::text NOT NULL,
    subscription_plan text,
    sort_order integer DEFAULT 0 NOT NULL,
    team_size integer DEFAULT 1,
    phone_status text DEFAULT 'inactive'::text NOT NULL,
    telnyx_phone_number_id text,
    sms_enabled boolean DEFAULT true NOT NULL,
    email_enabled boolean DEFAULT true NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    demo_expires_at timestamp with time zone,
    save_preferences_enabled boolean DEFAULT true NOT NULL,
    preferences_instructions text,
    tts_voice text,
    tts_speed real,
    tts_soft boolean,
    forward_phone text,
    tts_cheerful boolean,
    tts_formal boolean,
    tts_warm boolean,
    tts_concise boolean
);

ALTER TABLE ONLY public.tenants FORCE ROW LEVEL SECURITY;


--
-- Name: COLUMN tenants.phone_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenants.phone_status IS 'Phone provisioning lifecycle: inactive, provisioning, active, failed, deprovisioned';


--
-- Name: COLUMN tenants.telnyx_phone_number_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenants.telnyx_phone_number_id IS 'Telnyx phone number ID (UUID-style) returned from POST /v2/number_orders; used to release the number on deactivation';


--
-- Name: COLUMN tenants.sms_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenants.sms_enabled IS 'Per-tenant SMS reminder channel toggle. Default TRUE — owner opts out by explicit UPDATE.';


--
-- Name: COLUMN tenants.email_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenants.email_enabled IS 'Per-tenant email reminder channel toggle. Default TRUE — owner opts out by explicit UPDATE.';


--
-- Name: COLUMN tenants.save_preferences_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenants.save_preferences_enabled IS 'Preference capture enabled by default. Owners can opt out via the AI Persona dashboard.';


--
-- Name: COLUMN tenants.preferences_instructions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenants.preferences_instructions IS 'Owner-authored guidance injected into the AI system prompt: what customer preferences to save, why, when, and how to use them. NULL = use the agent built-in default guidance.';


--
-- Name: COLUMN tenants.tts_voice; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenants.tts_voice IS 'xAI Grok TTS voice_id (eve/ara/rex/sal/leo or a custom clone id). NULL = agent XAI_TTS_VOICE default.';


--
-- Name: COLUMN tenants.tts_speed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenants.tts_speed IS 'Grok TTS speech pace multiplier 0.7–1.5. NULL = agent XAI_TTS_SPEED default.';


--
-- Name: COLUMN tenants.tts_soft; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenants.tts_soft IS 'Wrap TTS text in xAI <soft> prosody tag for a softer delivery. NULL = agent XAI_TTS_SOFT default.';


--
-- Name: COLUMN tenants.forward_phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenants.forward_phone IS 'E.164 PSTN number the agent cold-transfers live calls to (owner cell). NULL = transfer disabled, agent takes a message.';


--
-- Name: unanswered_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unanswered_questions (
    unanswered_question_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    question text NOT NULL,
    caller_phone text,
    call_id text,
    caller_message text,
    owner_notified boolean DEFAULT false NOT NULL,
    resolved boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.unanswered_questions FORCE ROW LEVEL SECURITY;


--
-- Name: user_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_feedback (
    user_feedback_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    page text NOT NULL,
    context text,
    comment text NOT NULL,
    rating integer,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.user_feedback FORCE ROW LEVEL SECURITY;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    full_name text,
    created_at timestamp with time zone DEFAULT now(),
    first_name text,
    last_name text,
    password_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    role text DEFAULT 'owner'::text NOT NULL,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'front_desk'::text])))
);

ALTER TABLE ONLY public.users FORCE ROW LEVEL SECURITY;


--
-- Name: voice_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voice_sessions (
    voice_session_id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    call_id text NOT NULL,
    caller_phone text,
    customer_id uuid,
    customer_context jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'active'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    ended_at timestamp with time zone,
    duration_seconds integer,
    transcript text,
    summary text,
    outcome text,
    appointment_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_deleted boolean DEFAULT false,
    deleted_at timestamp with time zone,
    deleted_by text,
    requested_service_id uuid,
    CONSTRAINT voice_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'failed'::text, 'transferred'::text])))
);

ALTER TABLE ONLY public.voice_sessions FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE voice_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.voice_sessions IS 'Per-call voice session state. RLS forced 2026-05-09 — closes gap from 20260409 (RLS+policy were enabled but FORCE was not).';


--
-- Name: ai_cost_events ai_cost_event_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_cost_events ALTER COLUMN ai_cost_event_id SET DEFAULT nextval('public.ai_cost_events_ai_cost_event_id_seq'::regclass);


--
-- Name: communications_history communications_history_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_history ALTER COLUMN communications_history_id SET DEFAULT nextval('public.communications_history_communications_history_id_seq'::regclass);


--
-- Name: consent_records consent_record_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records ALTER COLUMN consent_record_id SET DEFAULT nextval('public.consent_records_id_seq'::regclass);


--
-- Name: message_delivery_status message_delivery_status_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_delivery_status ALTER COLUMN message_delivery_status_id SET DEFAULT nextval('public.message_delivery_status_message_delivery_status_id_seq'::regclass);


--
-- Name: opt_out_records opt_out_record_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_out_records ALTER COLUMN opt_out_record_id SET DEFAULT nextval('public.opt_out_records_id_seq'::regclass);


--
-- Name: reminder_schedules reminder_schedule_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_schedules ALTER COLUMN reminder_schedule_id SET DEFAULT nextval('public.reminder_schedules_id_seq'::regclass);


--
-- Name: ai_cost_events ai_cost_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_cost_events
    ADD CONSTRAINT ai_cost_events_pkey PRIMARY KEY (ai_cost_event_id);


--
-- Name: appointment_sync_map appointment_sync_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_sync_map
    ADD CONSTRAINT appointment_sync_map_pkey PRIMARY KEY (appointment_id);


--
-- Name: appointments appointments_no_employee_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_no_employee_overlap EXCLUDE USING gist (employee_id WITH =, tstzrange(start_time, end_time, '[)'::text) WITH &&) WHERE (((employee_id IS NOT NULL) AND (status = 'scheduled'::text) AND ((is_deleted IS NULL) OR (is_deleted = false))));


--
-- Name: appointments appointments_no_resource_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_no_resource_overlap EXCLUDE USING gist (resource_id WITH =, tstzrange(start_time, end_time, '[)'::text) WITH &&) WHERE (((status = 'scheduled'::text) AND ((is_deleted IS NULL) OR (is_deleted = false))));


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (appointment_id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (audit_log_id);


--
-- Name: business_templates business_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_templates
    ADD CONSTRAINT business_templates_pkey PRIMARY KEY (business_type);


--
-- Name: call_summaries call_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_summaries
    ADD CONSTRAINT call_summaries_pkey PRIMARY KEY (call_summary_id);


--
-- Name: call_transcripts call_transcripts_call_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_transcripts
    ADD CONSTRAINT call_transcripts_call_id_key UNIQUE (call_id);


--
-- Name: call_transcripts call_transcripts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_transcripts
    ADD CONSTRAINT call_transcripts_pkey PRIMARY KEY (call_transcript_id);


--
-- Name: communications_history communications_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_history
    ADD CONSTRAINT communications_history_pkey PRIMARY KEY (communications_history_id);


--
-- Name: consent_records consent_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_pkey PRIMARY KEY (consent_record_id);


--
-- Name: customer_messages customer_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_messages
    ADD CONSTRAINT customer_messages_pkey PRIMARY KEY (message_id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (customer_id);


--
-- Name: customers customers_tenant_id_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_tenant_id_phone_key UNIQUE (tenant_id, phone);


--
-- Name: employee_schedule employee_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_schedule
    ADD CONSTRAINT employee_schedule_pkey PRIMARY KEY (tenant_id, employee_id, shift_date);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (employee_id);


--
-- Name: entity_sync_map entity_sync_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_sync_map
    ADD CONSTRAINT entity_sync_map_pkey PRIMARY KEY (entity_sync_map_id);


--
-- Name: entity_sync_map entity_sync_map_tenant_id_provider_entity_type_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_sync_map
    ADD CONSTRAINT entity_sync_map_tenant_id_provider_entity_type_external_id_key UNIQUE (tenant_id, provider, entity_type, external_id);


--
-- Name: entity_sync_map entity_sync_map_tenant_id_provider_entity_type_local_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_sync_map
    ADD CONSTRAINT entity_sync_map_tenant_id_provider_entity_type_local_id_key UNIQUE (tenant_id, provider, entity_type, local_id);


--
-- Name: knowledge_suggestion knowledge_suggestion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_suggestion
    ADD CONSTRAINT knowledge_suggestion_pkey PRIMARY KEY (id);


--
-- Name: message_delivery_status message_delivery_status_message_sid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_delivery_status
    ADD CONSTRAINT message_delivery_status_message_sid_key UNIQUE (message_sid);


--
-- Name: message_delivery_status message_delivery_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_delivery_status
    ADD CONSTRAINT message_delivery_status_pkey PRIMARY KEY (message_delivery_status_id);


--
-- Name: opt_out_records opt_out_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_out_records
    ADD CONSTRAINT opt_out_records_pkey PRIMARY KEY (opt_out_record_id);


--
-- Name: password_resets password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_pkey PRIMARY KEY (password_reset_id);


--
-- Name: password_resets password_resets_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_token_hash_key UNIQUE (token_hash);


--
-- Name: phone_verifications phone_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_verifications
    ADD CONSTRAINT phone_verifications_pkey PRIMARY KEY (phone_verification_id);


--
-- Name: record_versions record_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_versions
    ADD CONSTRAINT record_versions_pkey PRIMARY KEY (record_version_id);


--
-- Name: reminder_schedules reminder_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_schedules
    ADD CONSTRAINT reminder_schedules_pkey PRIMARY KEY (reminder_schedule_id);


--
-- Name: resources resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_pkey PRIMARY KEY (resource_id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: service_employee service_employee_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_employee
    ADD CONSTRAINT service_employee_pkey PRIMARY KEY (service_id, employee_id);


--
-- Name: service_resource service_resource_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_resource
    ADD CONSTRAINT service_resource_pkey PRIMARY KEY (service_id, resource_id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (service_id);


--
-- Name: soft_reservations soft_reservations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.soft_reservations
    ADD CONSTRAINT soft_reservations_pkey PRIMARY KEY (soft_reservation_id);


--
-- Name: tenant_calendar_settings tenant_calendar_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_calendar_settings
    ADD CONSTRAINT tenant_calendar_settings_pkey PRIMARY KEY (tenant_id);


--
-- Name: tenant_docs tenant_docs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_docs
    ADD CONSTRAINT tenant_docs_pkey PRIMARY KEY (tenant_doc_id);


--
-- Name: tenant_integration_settings tenant_integration_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_integration_settings
    ADD CONSTRAINT tenant_integration_settings_pkey PRIMARY KEY (tenant_id, provider);


--
-- Name: tenant_skills tenant_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_skills
    ADD CONSTRAINT tenant_skills_pkey PRIMARY KEY (tenant_id, name);


--
-- Name: tenants tenants_inbound_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_inbound_phone_key UNIQUE (inbound_phone);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (tenant_id);


--
-- Name: unanswered_questions unanswered_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unanswered_questions
    ADD CONSTRAINT unanswered_questions_pkey PRIMARY KEY (unanswered_question_id);


--
-- Name: record_versions unique_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_versions
    ADD CONSTRAINT unique_version UNIQUE (tenant_id, table_name, record_id, version_number);


--
-- Name: user_feedback user_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feedback
    ADD CONSTRAINT user_feedback_pkey PRIMARY KEY (user_feedback_id);


--
-- Name: users users_email_tenant_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_tenant_unique UNIQUE (tenant_id, email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: voice_sessions voice_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_sessions
    ADD CONSTRAINT voice_sessions_pkey PRIMARY KEY (voice_session_id);


--
-- Name: voice_sessions voice_sessions_tenant_id_call_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_sessions
    ADD CONSTRAINT voice_sessions_tenant_id_call_id_key UNIQUE (tenant_id, call_id);


--
-- Name: ai_cost_events_tenant_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_cost_events_tenant_month ON public.ai_cost_events USING btree (tenant_id, created_at);


--
-- Name: idx_appointments_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_appointments_active ON public.appointments USING btree (tenant_id) WHERE (is_deleted = false);


--
-- Name: idx_appointments_assigned_to_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_appointments_assigned_to_user_id ON public.appointments USING btree (assigned_to_user_id);


--
-- Name: idx_appointments_call_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_appointments_call_id ON public.appointments USING btree (call_id) WHERE (call_id IS NOT NULL);


--
-- Name: idx_appointments_is_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_appointments_is_deleted ON public.appointments USING btree (tenant_id, is_deleted) WHERE (NOT is_deleted);


--
-- Name: idx_appointments_service_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_appointments_service_id ON public.appointments USING btree (service_id) WHERE (service_id IS NOT NULL);


--
-- Name: idx_appointments_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_appointments_updated_at ON public.appointments USING btree (tenant_id, updated_at);


--
-- Name: idx_audit_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_created_at ON public.audit_log USING btree (created_at);


--
-- Name: idx_audit_log_table_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_table_record ON public.audit_log USING btree (table_name, record_id);


--
-- Name: idx_audit_log_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_tenant ON public.audit_log USING btree (tenant_id);


--
-- Name: idx_communications_history_tenant_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communications_history_tenant_channel ON public.communications_history USING btree (tenant_id, channel);


--
-- Name: idx_communications_history_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_communications_history_tenant_created ON public.communications_history USING btree (tenant_id, created_at DESC);


--
-- Name: idx_consent_records_customer_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_records_customer_email ON public.consent_records USING btree (customer_email) WHERE (customer_email IS NOT NULL);


--
-- Name: idx_consent_records_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_records_customer_id ON public.consent_records USING btree (customer_id) WHERE (customer_id IS NOT NULL);


--
-- Name: idx_consent_records_customer_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_records_customer_phone ON public.consent_records USING btree (customer_phone) WHERE (customer_phone IS NOT NULL);


--
-- Name: idx_consent_records_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_records_tenant_id ON public.consent_records USING btree (tenant_id);


--
-- Name: idx_customer_messages_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_messages_tenant ON public.customer_messages USING btree (tenant_id, created_at DESC);


--
-- Name: idx_customers_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_active ON public.customers USING btree (tenant_id) WHERE (is_deleted = false);


--
-- Name: idx_customers_is_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_is_deleted ON public.customers USING btree (tenant_id, is_deleted) WHERE (NOT is_deleted);


--
-- Name: idx_customers_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_updated_at ON public.customers USING btree (tenant_id, updated_at);


--
-- Name: idx_employee_schedule_employee_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_schedule_employee_date ON public.employee_schedule USING btree (employee_id, shift_date);


--
-- Name: idx_employee_schedule_tenant_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_schedule_tenant_date ON public.employee_schedule USING btree (tenant_id, shift_date);


--
-- Name: idx_employees_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_active ON public.employees USING btree (tenant_id) WHERE (is_deleted = false);


--
-- Name: idx_employees_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employees_tenant_id ON public.employees USING btree (tenant_id);


--
-- Name: idx_entity_sync_map_external; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_sync_map_external ON public.entity_sync_map USING btree (tenant_id, provider, entity_type, external_id);


--
-- Name: idx_entity_sync_map_local; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_sync_map_local ON public.entity_sync_map USING btree (tenant_id, provider, entity_type, local_id);


--
-- Name: idx_entity_sync_map_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_sync_map_pending ON public.entity_sync_map USING btree (sync_status) WHERE (sync_status <> 'synced'::text);


--
-- Name: idx_message_delivery_status_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_delivery_status_tenant ON public.message_delivery_status USING btree (tenant_id, updated_at DESC);


--
-- Name: idx_opt_out_records_customer_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opt_out_records_customer_email ON public.opt_out_records USING btree (customer_email) WHERE (customer_email IS NOT NULL);


--
-- Name: idx_opt_out_records_customer_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opt_out_records_customer_phone ON public.opt_out_records USING btree (customer_phone) WHERE (customer_phone IS NOT NULL);


--
-- Name: idx_opt_out_records_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opt_out_records_tenant_id ON public.opt_out_records USING btree (tenant_id);


--
-- Name: idx_password_resets_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_resets_expires_at ON public.password_resets USING btree (expires_at);


--
-- Name: idx_password_resets_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_resets_user_id ON public.password_resets USING btree (user_id);


--
-- Name: idx_phone_verifications_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phone_verifications_active ON public.phone_verifications USING btree (tenant_id, phone, created_at DESC) WHERE (verified_at IS NULL);


--
-- Name: idx_phone_verifications_rate_limit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_phone_verifications_rate_limit ON public.phone_verifications USING btree (tenant_id, phone, created_at DESC);


--
-- Name: idx_record_versions_change_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_record_versions_change_source ON public.record_versions USING btree (tenant_id, change_source);


--
-- Name: idx_record_versions_changed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_record_versions_changed_at ON public.record_versions USING btree (tenant_id, changed_at DESC);


--
-- Name: idx_record_versions_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_record_versions_lookup ON public.record_versions USING btree (tenant_id, table_name, record_id);


--
-- Name: idx_reminder_schedules_appointment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminder_schedules_appointment_id ON public.reminder_schedules USING btree (appointment_id);


--
-- Name: idx_reminder_schedules_pickup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminder_schedules_pickup ON public.reminder_schedules USING btree (scheduled_for, next_retry_at) WHERE ((status)::text = 'scheduled'::text);


--
-- Name: idx_reminder_schedules_status_scheduled_for; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminder_schedules_status_scheduled_for ON public.reminder_schedules USING btree (status, scheduled_for) WHERE ((status)::text = 'scheduled'::text);


--
-- Name: idx_reminder_schedules_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reminder_schedules_tenant_id ON public.reminder_schedules USING btree (tenant_id);


--
-- Name: idx_resources_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resources_active ON public.resources USING btree (tenant_id) WHERE (is_deleted = false);


--
-- Name: idx_resources_is_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resources_is_deleted ON public.resources USING btree (tenant_id, is_deleted) WHERE (NOT is_deleted);


--
-- Name: idx_services_is_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_is_deleted ON public.services USING btree (tenant_id, is_deleted) WHERE (NOT is_deleted);


--
-- Name: idx_services_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_tenant_id ON public.services USING btree (tenant_id);


--
-- Name: idx_soft_reservations_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_soft_reservations_expires_at ON public.soft_reservations USING btree (expires_at);


--
-- Name: idx_tenants_demo_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_demo_expires ON public.tenants USING btree (demo_expires_at) WHERE (is_demo = true);


--
-- Name: idx_tenants_stripe_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_stripe_customer ON public.tenants USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);


--
-- Name: idx_tenants_telnyx_phone_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_telnyx_phone_number ON public.tenants USING btree (telnyx_phone_number_id) WHERE (telnyx_phone_number_id IS NOT NULL);


--
-- Name: idx_unanswered_questions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unanswered_questions_tenant ON public.unanswered_questions USING btree (tenant_id, created_at DESC);


--
-- Name: idx_unanswered_questions_unresolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unanswered_questions_unresolved ON public.unanswered_questions USING btree (tenant_id) WHERE (resolved = false);


--
-- Name: idx_voice_sessions_caller_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_sessions_caller_phone ON public.voice_sessions USING btree (caller_phone);


--
-- Name: idx_voice_sessions_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_sessions_customer_id ON public.voice_sessions USING btree (customer_id);


--
-- Name: idx_voice_sessions_is_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_sessions_is_deleted ON public.voice_sessions USING btree (tenant_id, is_deleted) WHERE (NOT is_deleted);


--
-- Name: idx_voice_sessions_requested_service_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_sessions_requested_service_id ON public.voice_sessions USING btree (requested_service_id) WHERE (requested_service_id IS NOT NULL);


--
-- Name: idx_voice_sessions_started_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_sessions_started_at ON public.voice_sessions USING btree (started_at DESC);


--
-- Name: idx_voice_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_sessions_status ON public.voice_sessions USING btree (status);


--
-- Name: idx_voice_sessions_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_sessions_tenant_id ON public.voice_sessions USING btree (tenant_id);


--
-- Name: knowledge_suggestion_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_suggestion_status_idx ON public.knowledge_suggestion USING btree (tenant_id, status);


--
-- Name: knowledge_suggestion_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_suggestion_tenant_idx ON public.knowledge_suggestion USING btree (tenant_id);


--
-- Name: tenant_docs_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_docs_embedding_idx ON public.tenant_docs USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: appointments appointments_auto_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER appointments_auto_version AFTER INSERT OR DELETE OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.auto_version_trigger();


--
-- Name: consent_records consent_records_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER consent_records_updated_at BEFORE UPDATE ON public.consent_records FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: customers customers_auto_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER customers_auto_version AFTER INSERT OR DELETE OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.auto_version_trigger();


--
-- Name: employees employees_auto_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER employees_auto_version AFTER INSERT OR DELETE OR UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.auto_version_trigger();


--
-- Name: tenants on_tenant_created_defaults; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_tenant_created_defaults BEFORE INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.apply_business_template_defaults();


--
-- Name: tenants on_tenant_created_resources; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_tenant_created_resources AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.create_default_resources();


--
-- Name: reminder_schedules reminder_schedules_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reminder_schedules_updated_at BEFORE UPDATE ON public.reminder_schedules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: resources resources_auto_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER resources_auto_version AFTER INSERT OR DELETE OR UPDATE ON public.resources FOR EACH ROW EXECUTE FUNCTION public.auto_version_trigger();


--
-- Name: services services_auto_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER services_auto_version AFTER INSERT OR DELETE OR UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.auto_version_trigger();


--
-- Name: appointments trg_appointments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_appointments_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: appointments trg_audit_appointments; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_appointments AFTER INSERT OR DELETE OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: customers trg_audit_customers; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_customers AFTER INSERT OR DELETE OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: employees trg_audit_employees; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_employees AFTER INSERT OR DELETE OR UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: resources trg_audit_resources; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_resources AFTER INSERT OR DELETE OR UPDATE ON public.resources FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: services trg_audit_services; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_services AFTER INSERT OR DELETE OR UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();


--
-- Name: customers trg_customers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: customers trg_sync_customer_names; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_customer_names BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.sync_customer_names();


--
-- Name: users trg_sync_user_names; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_user_names BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.sync_user_names();


--
-- Name: appointments trigger_notify_n8n_appointment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_notify_n8n_appointment AFTER INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.notify_n8n_on_appointment();


--
-- Name: voice_sessions voice_sessions_auto_version; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER voice_sessions_auto_version AFTER INSERT OR DELETE OR UPDATE ON public.voice_sessions FOR EACH ROW EXECUTE FUNCTION public.auto_version_trigger();


--
-- Name: ai_cost_events ai_cost_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_cost_events
    ADD CONSTRAINT ai_cost_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: appointment_sync_map appointment_sync_map_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointment_sync_map
    ADD CONSTRAINT appointment_sync_map_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(appointment_id) ON DELETE CASCADE;


--
-- Name: appointments appointments_assigned_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_assigned_to_user_id_fkey FOREIGN KEY (assigned_to_user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: appointments appointments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE CASCADE;


--
-- Name: appointments appointments_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id) ON DELETE SET NULL;


--
-- Name: appointments appointments_resource_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.resources(resource_id) ON DELETE CASCADE;


--
-- Name: appointments appointments_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(service_id) ON DELETE SET NULL;


--
-- Name: appointments appointments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: audit_log audit_log_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: call_summaries call_summaries_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_summaries
    ADD CONSTRAINT call_summaries_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE CASCADE;


--
-- Name: call_summaries call_summaries_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_summaries
    ADD CONSTRAINT call_summaries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: call_transcripts call_transcripts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_transcripts
    ADD CONSTRAINT call_transcripts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE SET NULL;


--
-- Name: call_transcripts call_transcripts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_transcripts
    ADD CONSTRAINT call_transcripts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: communications_history communications_history_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_history
    ADD CONSTRAINT communications_history_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE SET NULL;


--
-- Name: communications_history communications_history_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications_history
    ADD CONSTRAINT communications_history_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: consent_records consent_records_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE SET NULL;


--
-- Name: consent_records consent_records_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_records
    ADD CONSTRAINT consent_records_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: customer_messages customer_messages_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_messages
    ADD CONSTRAINT customer_messages_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id);


--
-- Name: customer_messages customer_messages_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_messages
    ADD CONSTRAINT customer_messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: customers customers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: employees employees_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: entity_sync_map entity_sync_map_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_sync_map
    ADD CONSTRAINT entity_sync_map_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: knowledge_suggestion knowledge_suggestion_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_suggestion
    ADD CONSTRAINT knowledge_suggestion_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: message_delivery_status message_delivery_status_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_delivery_status
    ADD CONSTRAINT message_delivery_status_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: opt_out_records opt_out_records_original_consent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_out_records
    ADD CONSTRAINT opt_out_records_original_consent_id_fkey FOREIGN KEY (original_consent_record_id) REFERENCES public.consent_records(consent_record_id) ON DELETE SET NULL;


--
-- Name: opt_out_records opt_out_records_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opt_out_records
    ADD CONSTRAINT opt_out_records_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: password_resets password_resets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: phone_verifications phone_verifications_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_verifications
    ADD CONSTRAINT phone_verifications_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: record_versions record_versions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_versions
    ADD CONSTRAINT record_versions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: reminder_schedules reminder_schedules_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_schedules
    ADD CONSTRAINT reminder_schedules_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(appointment_id) ON DELETE CASCADE;


--
-- Name: reminder_schedules reminder_schedules_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_schedules
    ADD CONSTRAINT reminder_schedules_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: resources resources_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: service_employee service_employee_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_employee
    ADD CONSTRAINT service_employee_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id) ON DELETE CASCADE;


--
-- Name: service_employee service_employee_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_employee
    ADD CONSTRAINT service_employee_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(service_id) ON DELETE CASCADE;


--
-- Name: service_employee service_employee_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_employee
    ADD CONSTRAINT service_employee_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: service_resource service_resource_resource_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_resource
    ADD CONSTRAINT service_resource_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.resources(resource_id) ON DELETE CASCADE;


--
-- Name: service_resource service_resource_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_resource
    ADD CONSTRAINT service_resource_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(service_id) ON DELETE CASCADE;


--
-- Name: service_resource service_resource_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_resource
    ADD CONSTRAINT service_resource_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: services services_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: employee_schedule shift_overrides_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_schedule
    ADD CONSTRAINT shift_overrides_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id) ON DELETE CASCADE;


--
-- Name: employee_schedule shift_overrides_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_schedule
    ADD CONSTRAINT shift_overrides_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: soft_reservations soft_reservations_resource_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.soft_reservations
    ADD CONSTRAINT soft_reservations_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.resources(resource_id) ON DELETE CASCADE;


--
-- Name: soft_reservations soft_reservations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.soft_reservations
    ADD CONSTRAINT soft_reservations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: tenant_calendar_settings tenant_calendar_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_calendar_settings
    ADD CONSTRAINT tenant_calendar_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: tenant_docs tenant_docs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_docs
    ADD CONSTRAINT tenant_docs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: tenant_integration_settings tenant_integration_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_integration_settings
    ADD CONSTRAINT tenant_integration_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: tenant_skills tenant_skills_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_skills
    ADD CONSTRAINT tenant_skills_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: unanswered_questions unanswered_questions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unanswered_questions
    ADD CONSTRAINT unanswered_questions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: user_feedback user_feedback_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feedback
    ADD CONSTRAINT user_feedback_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: user_feedback user_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_feedback
    ADD CONSTRAINT user_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: users users_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: voice_sessions voice_sessions_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_sessions
    ADD CONSTRAINT voice_sessions_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(appointment_id) ON DELETE SET NULL;


--
-- Name: voice_sessions voice_sessions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_sessions
    ADD CONSTRAINT voice_sessions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE SET NULL;


--
-- Name: voice_sessions voice_sessions_requested_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_sessions
    ADD CONSTRAINT voice_sessions_requested_service_id_fkey FOREIGN KEY (requested_service_id) REFERENCES public.services(service_id) ON DELETE SET NULL;


--
-- Name: voice_sessions voice_sessions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_sessions
    ADD CONSTRAINT voice_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(tenant_id) ON DELETE CASCADE;


--
-- Name: employee_schedule Admin bypass for employee_schedule; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin bypass for employee_schedule" ON public.employee_schedule USING ((NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text) IS NULL));


--
-- Name: entity_sync_map Admin bypass for entity sync map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin bypass for entity sync map" ON public.entity_sync_map USING (((current_setting('app.current_tenant_id'::text, true) IS NULL) OR (current_setting('app.current_tenant_id'::text, true) = ''::text)));


--
-- Name: tenant_integration_settings Admin bypass for integration settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin bypass for integration settings" ON public.tenant_integration_settings USING (((current_setting('app.current_tenant_id'::text, true) IS NULL) OR (current_setting('app.current_tenant_id'::text, true) = ''::text)));


--
-- Name: business_templates Publicly readable templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Publicly readable templates" ON public.business_templates FOR SELECT USING (true);


--
-- Name: tenant_docs Tenant docs are isolated by tenant_id; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant docs are isolated by tenant_id" ON public.tenant_docs USING ((tenant_id = (( SELECT current_setting('app.current_tenant_id'::text, true) AS current_setting))::uuid));


--
-- Name: tenant_calendar_settings Tenant isolation for calendar settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation for calendar settings" ON public.tenant_calendar_settings USING ((tenant_id = (( SELECT current_setting('app.current_tenant_id'::text, true) AS current_setting))::uuid));


--
-- Name: employee_schedule Tenant isolation for employee_schedule; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation for employee_schedule" ON public.employee_schedule USING ((tenant_id = (( SELECT current_setting('app.current_tenant_id'::text, true) AS current_setting))::uuid));


--
-- Name: entity_sync_map Tenant isolation for entity sync map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation for entity sync map" ON public.entity_sync_map USING ((tenant_id = (( SELECT current_setting('app.current_tenant_id'::text, true) AS current_setting))::uuid));


--
-- Name: tenant_integration_settings Tenant isolation for integration settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation for integration settings" ON public.tenant_integration_settings USING ((tenant_id = (( SELECT current_setting('app.current_tenant_id'::text, true) AS current_setting))::uuid));


--
-- Name: tenant_skills Tenant isolation for master skills; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation for master skills" ON public.tenant_skills USING ((tenant_id = (( SELECT current_setting('app.current_tenant_id'::text, true) AS current_setting))::uuid));


--
-- Name: appointment_sync_map Tenant isolation for sync map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Tenant isolation for sync map" ON public.appointment_sync_map USING ((EXISTS ( SELECT 1
   FROM public.appointments a
  WHERE ((a.appointment_id = appointment_sync_map.appointment_id) AND (a.tenant_id = (( SELECT current_setting('app.current_tenant_id'::text, true) AS current_setting))::uuid)))));


--
-- Name: business_templates admin_bypass_business_templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_bypass_business_templates ON public.business_templates USING ((NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text) IS NULL));


--
-- Name: tenants admin_bypass_tenants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_bypass_tenants ON public.tenants USING ((NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text) IS NULL));


--
-- Name: users admin_bypass_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_bypass_users ON public.users USING ((NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text) IS NULL));


--
-- Name: ai_cost_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_cost_events ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_cost_events ai_cost_events_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_cost_events_tenant_isolation ON public.ai_cost_events USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: appointment_sync_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointment_sync_map ENABLE ROW LEVEL SECURITY;

--
-- Name: appointments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_log_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_tenant_isolation ON public.audit_log USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: business_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.business_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: call_summaries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.call_summaries ENABLE ROW LEVEL SECURITY;

--
-- Name: call_transcripts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.call_transcripts ENABLE ROW LEVEL SECURITY;

--
-- Name: communications_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communications_history ENABLE ROW LEVEL SECURITY;

--
-- Name: communications_history communications_history_admin_bypass; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communications_history_admin_bypass ON public.communications_history USING ((current_setting('app.current_tenant_id'::text, true) = ''::text));


--
-- Name: communications_history communications_history_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY communications_history_tenant_isolation ON public.communications_history USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: consent_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

--
-- Name: consent_records consent_records_admin_bypass; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consent_records_admin_bypass ON public.consent_records USING ((current_setting('app.current_tenant_id'::text, true) = ''::text));


--
-- Name: consent_records consent_records_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consent_records_tenant_isolation ON public.consent_records USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: customer_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_messages customer_messages_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_messages_tenant_isolation ON public.customer_messages USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: employee_schedule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employee_schedule ENABLE ROW LEVEL SECURITY;

--
-- Name: employees; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

--
-- Name: employees employees_tenant_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employees_tenant_access ON public.employees USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: entity_sync_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.entity_sync_map ENABLE ROW LEVEL SECURITY;

--
-- Name: user_feedback feedback_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feedback_tenant_isolation ON public.user_feedback USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: knowledge_suggestion; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.knowledge_suggestion ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_suggestion knowledge_suggestion_admin_bypass; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_suggestion_admin_bypass ON public.knowledge_suggestion USING ((current_setting('app.current_tenant_id'::text, true) = ''::text));


--
-- Name: knowledge_suggestion knowledge_suggestion_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_suggestion_tenant_isolation ON public.knowledge_suggestion USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: opt_out_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opt_out_records ENABLE ROW LEVEL SECURITY;

--
-- Name: opt_out_records opt_out_records_admin_bypass; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY opt_out_records_admin_bypass ON public.opt_out_records USING ((current_setting('app.current_tenant_id'::text, true) = ''::text));


--
-- Name: opt_out_records opt_out_records_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY opt_out_records_tenant_isolation ON public.opt_out_records USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: password_resets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;

--
-- Name: password_resets password_resets_unauthenticated_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY password_resets_unauthenticated_only ON public.password_resets USING ((NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text) IS NULL)) WITH CHECK ((NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text) IS NULL));


--
-- Name: POLICY password_resets_unauthenticated_only ON password_resets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY password_resets_unauthenticated_only ON public.password_resets IS 'Only the unauthenticated forgot-password / reset-password flow can read or write this table. Authenticated tenant sessions (with app.current_tenant_id set) cannot. Added 2026-05-09 — closes RLS gap from migration 20260422.';


--
-- Name: phone_verifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.phone_verifications ENABLE ROW LEVEL SECURITY;

--
-- Name: phone_verifications phone_verifications_admin_bypass; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY phone_verifications_admin_bypass ON public.phone_verifications USING (((current_setting('app.current_tenant_id'::text, true) = ''::text) OR (current_setting('app.current_tenant_id'::text, true) IS NULL)));


--
-- Name: phone_verifications phone_verifications_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY phone_verifications_tenant_isolation ON public.phone_verifications USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: record_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.record_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: record_versions record_versions_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY record_versions_tenant_isolation ON public.record_versions USING (((tenant_id = COALESCE((current_setting('app.current_tenant_id'::text, true))::uuid, '00000000-0000-0000-0000-000000000000'::uuid)) OR (current_setting('app.current_tenant_id'::text, true) = '00000000-0000-0000-0000-000000000000'::text)));


--
-- Name: reminder_schedules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reminder_schedules ENABLE ROW LEVEL SECURITY;

--
-- Name: reminder_schedules reminder_schedules_admin_bypass; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reminder_schedules_admin_bypass ON public.reminder_schedules USING ((current_setting('app.current_tenant_id'::text, true) = ''::text));


--
-- Name: reminder_schedules reminder_schedules_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reminder_schedules_tenant_isolation ON public.reminder_schedules USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- Name: resources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

--
-- Name: service_employee; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_employee ENABLE ROW LEVEL SECURITY;

--
-- Name: service_employee service_employee_tenant_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_employee_tenant_access ON public.service_employee USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: service_resource; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_resource ENABLE ROW LEVEL SECURITY;

--
-- Name: service_resource service_resource_tenant_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_resource_tenant_access ON public.service_resource USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: services; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

--
-- Name: services services_tenant_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY services_tenant_access ON public.services USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: soft_reservations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.soft_reservations ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_calendar_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_calendar_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_docs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_docs ENABLE ROW LEVEL SECURITY;

--
-- Name: tenant_integration_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_integration_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: appointments tenant_isolation_appointments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_appointments ON public.appointments USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: call_summaries tenant_isolation_call_summaries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_call_summaries ON public.call_summaries USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: call_transcripts tenant_isolation_call_transcripts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_call_transcripts ON public.call_transcripts USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: customers tenant_isolation_customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_customers ON public.customers USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: resources tenant_isolation_resources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_resources ON public.resources USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: soft_reservations tenant_isolation_soft_reservations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_soft_reservations ON public.soft_reservations USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: tenants tenant_isolation_tenants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation_tenants ON public.tenants USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: tenant_skills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenant_skills ENABLE ROW LEVEL SECURITY;

--
-- Name: tenants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

--
-- Name: unanswered_questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unanswered_questions ENABLE ROW LEVEL SECURITY;

--
-- Name: unanswered_questions unanswered_questions_admin_bypass; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY unanswered_questions_admin_bypass ON public.unanswered_questions USING (((current_setting('app.current_tenant_id'::text, true) = ''::text) OR (current_setting('app.current_tenant_id'::text, true) IS NULL)));


--
-- Name: unanswered_questions unanswered_questions_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY unanswered_questions_tenant_isolation ON public.unanswered_questions USING ((tenant_id = (current_setting('app.current_tenant_id'::text, true))::uuid));


--
-- Name: user_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: users user_isolation_users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_isolation_users ON public.users USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: voice_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.voice_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: voice_sessions voice_sessions_tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY voice_sessions_tenant_isolation ON public.voice_sessions USING (((tenant_id)::text = current_setting('app.current_tenant_id'::text, true)));


--
-- PostgreSQL database dump complete
--

\unrestrict dwx9xdbj36z5heMaJXHoyyaNYSchPt8VS9bc2aUDwg2eVtW59sZV3z5srPuiGwV

