-- Drop the employee_shifts table and its remaining references.
-- NEEDS-REFACTORING #4 Phase 2.
--
-- Background. We don't model weekly recurring shifts. The platform's
-- only schedule storage is `employee_schedule` (date-specific rows).
-- The wizard collects a weekly grid in form state and posts it to
-- /shifts/expand-weekly, which fans the pattern into employee_schedule.
-- Nothing reads `employee_shifts` for booking, scheduling, or analytics
-- anymore (verified by code inspection across src/, dashboard/,
-- and the remaining RPCs).
--
-- This migration:
--
--   1. Rewrites check_coverage_gaps + check_availability_with_tz to
--      drop their employee_shifts fallback paths. They now read
--      employee_schedule exclusively — same source of truth as the
--      booking RPCs.
--   2. Drops the employee_shifts table (CASCADE to remove the RLS
--      policies and indexes that hang off it).
--
-- After this, no production code references employee_shifts. The
-- next test run will exercise the new contract end-to-end.

-- ----------------------------------------------------------------
-- 1. check_coverage_gaps — schedule-only version
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_coverage_gaps(
    p_tenant_id uuid,
    p_start_date date DEFAULT CURRENT_DATE,
    p_end_date date DEFAULT (CURRENT_DATE + 6)
)
RETURNS TABLE(
    service_id uuid,
    service_name text,
    check_date date,
    gap_hours integer[],
    covered_hours integer[],
    total_open_hours integer,
    coverage_pct numeric,
    status text,
    details jsonb
)
LANGUAGE plpgsql
STABLE
AS $function$
BEGIN
    RETURN QUERY
    WITH tenant_services AS (
        SELECT s.id AS sid, s.name AS sname
        FROM services s
        WHERE s.tenant_id = p_tenant_id
    ),
    date_series AS (
        SELECT d::DATE AS check_date
        FROM generate_series(p_start_date, p_end_date, '1 day'::INTERVAL) AS d
    ),
    -- Cover an hour for a service if AT LEAST one assigned employee has
    -- a working employee_schedule row that includes that hour.
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
    -- An hour is "open" on a date if any active employee has a working
    -- employee_schedule row that includes it. Used to scope the
    -- covered/gap math to hours the business is actually staffed.
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


-- ----------------------------------------------------------------
-- 2. check_availability_with_tz — schedule-only version
-- ----------------------------------------------------------------

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
    v_start_tod TIME;
    v_end_tod TIME;
BEGIN
    SELECT COALESCE(t.timezone, 'UTC') INTO v_tenant_tz
    FROM tenants t WHERE t.id = p_tenant_id;
    IF v_tenant_tz IS NULL THEN v_tenant_tz := 'UTC'; END IF;

    v_display_tz := COALESCE(p_customer_tz, v_tenant_tz);
    v_shift_date := (p_start_time AT TIME ZONE v_tenant_tz)::DATE;
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

    -- Any active employee with a working employee_schedule row
    -- covering the requested window. Supports normal AND night shifts
    -- (start > end → crosses midnight).
    SELECT EXISTS (
        SELECT 1 FROM employees emp
        JOIN employee_schedule sch
            ON sch.employee_id = emp.id
            AND sch.tenant_id = p_tenant_id
            AND sch.shift_date = v_shift_date
            AND sch.is_off = false
        WHERE emp.tenant_id = p_tenant_id
        AND emp.is_active = true
        AND (emp.is_deleted IS NULL OR emp.is_deleted = false)
        AND (
            -- Normal shift: start <= end
            (sch.start_time <= sch.end_time
             AND sch.start_time <= v_start_tod
             AND sch.end_time >= v_end_tod)
            OR
            -- Night shift: start > end (crosses midnight)
            (sch.start_time > sch.end_time
             AND (v_start_tod >= sch.start_time OR v_end_tod <= sch.end_time))
        )
    ) INTO v_staff_available;

    RETURN QUERY SELECT
        (v_resource_free AND v_staff_available),
        v_display_tz,
        to_char(p_start_time AT TIME ZONE v_display_tz, 'YYYY-MM-DD HH24:MI'),
        to_char(p_end_time AT TIME ZONE v_display_tz, 'YYYY-MM-DD HH24:MI');
END;
$function$;


-- ----------------------------------------------------------------
-- 3. Drop the employee_shifts table itself
-- ----------------------------------------------------------------
-- CASCADE handles the RLS policies, indexes, and FK constraints that
-- hang off the table. There are no FKs pointing INTO employee_shifts
-- from other tables (verified via the schema inspection done in the
-- code-removal pass above), so CASCADE only sweeps employee_shifts'
-- own dependencies.

DROP TABLE IF EXISTS employee_shifts CASCADE;
