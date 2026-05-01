-- Fix two RPCs that the 2026-04-20 rename migration missed.
--
-- `20260420000000_rename_shift_overrides_to_employee_schedule.sql`
-- renamed the table AND updated `get_effective_shifts`,
-- `get_effective_shifts_bulk`, `book_appointment_atomic`, and
-- `book_with_scheduling_atomic`. But two coverage/availability RPCs
-- continued to reference the old table name and have been broken
-- since the rename:
--
--   - check_coverage_gaps()       (4 references)
--   - check_availability_with_tz() (1 reference)
--
-- This migration replaces both with bodies that point at
-- `employee_schedule`. The function logic is otherwise identical to
-- what was last installed by 20260403000001 + 20260404000000 — only
-- the table name changed, plus the comments updated to drop the
-- "FIX #2" wording that referred to the override-vs-pattern split
-- in the original sub-table-rename world (the names "override" and
-- "pattern" are kept because they still accurately describe the
-- relationship between employee_schedule and employee_shifts).

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
        SELECT d::DATE AS check_date, EXTRACT(DOW FROM d)::INTEGER AS dow
        FROM generate_series(p_start_date, p_end_date, '1 day'::INTERVAL) AS d
    ),
    -- Check employee_schedule (date-specific) first, fall back to
    -- employee_shifts (weekly pattern) when no date-specific row.
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
                LEFT JOIN employee_schedule so
                    ON so.employee_id = e.id
                    AND so.tenant_id = p_tenant_id
                    AND so.shift_date = ds.check_date
                LEFT JOIN employee_shifts es
                    ON es.employee_id = e.id
                    AND es.day_of_week = ds.dow
                    AND es.is_active = true
                    AND so.id IS NULL  -- only use pattern when no date-specific row
                WHERE se.service_id = ts.sid
                  AND e.tenant_id = p_tenant_id
                  AND e.is_active = true
                  AND (e.is_deleted IS NULL OR e.is_deleted = false)
                  AND (
                      -- Date-specific row exists and employee is working
                      (so.id IS NOT NULL AND so.is_off = false
                       AND so.start_time <= make_time(h.hr, 0, 0)
                       AND so.end_time > make_time(h.hr, 0, 0))
                      OR
                      -- No date-specific row, use weekly pattern
                      (so.id IS NULL AND es.id IS NOT NULL
                       AND es.start_time <= make_time(h.hr, 0, 0)
                       AND es.end_time > make_time(h.hr, 0, 0))
                  )
            ) THEN true ELSE false END AS is_covered
        FROM tenant_services ts
        CROSS JOIN date_series ds
        CROSS JOIN generate_series(0, 23) AS h(hr)
    ),
    -- open_hours: hours where any employee is working (not service-scoped).
    open_hours AS (
        SELECT
            ds.check_date,
            ds.dow,
            h.hr
        FROM date_series ds
        CROSS JOIN generate_series(0, 23) AS h(hr)
        WHERE EXISTS (
            SELECT 1 FROM employees e
            LEFT JOIN employee_schedule so
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
$function$;


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
    -- Get tenant timezone
    SELECT COALESCE(t.timezone, 'UTC') INTO v_tenant_tz
    FROM tenants t WHERE t.id = p_tenant_id;
    IF v_tenant_tz IS NULL THEN v_tenant_tz := 'UTC'; END IF;

    v_display_tz := COALESCE(p_customer_tz, v_tenant_tz);
    v_shift_date := (p_start_time AT TIME ZONE v_tenant_tz)::DATE;
    v_day_of_week := EXTRACT(DOW FROM p_start_time AT TIME ZONE v_tenant_tz)::INTEGER;
    v_start_tod := (p_start_time AT TIME ZONE v_tenant_tz)::TIME;
    v_end_tod := (p_end_time AT TIME ZONE v_tenant_tz)::TIME;

    -- Check resource availability (appointment overlap)
    SELECT NOT EXISTS (
        SELECT 1 FROM appointments
        WHERE resource_id = p_resource_id
        AND tenant_id = p_tenant_id
        AND status = 'scheduled'
        AND (is_deleted IS NULL OR is_deleted = false)
        AND start_time < p_end_time
        AND end_time > p_start_time
    ) INTO v_resource_free;

    -- Check if any employee is on shift (date-specific row + weekly
    -- pattern fallback + night shift support).
    SELECT EXISTS (
        SELECT 1 FROM employees emp
        LEFT JOIN employee_schedule so
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
        AND (
            -- Date-specific row: working (not off)
            (so.id IS NOT NULL AND so.is_off = false AND (
                -- Normal shift: start < end
                (so.start_time <= so.end_time AND so.start_time <= v_start_tod AND so.end_time >= v_end_tod)
                OR
                -- Night shift: start > end (crosses midnight)
                (so.start_time > so.end_time AND (v_start_tod >= so.start_time OR v_end_tod <= so.end_time))
            ))
            OR
            -- Weekly pattern fallback: no date-specific row exists
            (so.id IS NULL AND es.id IS NOT NULL AND (
                -- Normal shift
                (es.start_time <= es.end_time AND es.start_time <= v_start_tod AND es.end_time >= v_end_tod)
                OR
                -- Night shift
                (es.start_time > es.end_time AND (v_start_tod >= es.start_time OR v_end_tod <= es.end_time))
            ))
        )
    ) INTO v_staff_available;

    RETURN QUERY SELECT
        (v_resource_free AND v_staff_available),
        v_display_tz,
        to_char(p_start_time AT TIME ZONE v_display_tz, 'YYYY-MM-DD HH24:MI'),
        to_char(p_end_time AT TIME ZONE v_display_tz, 'YYYY-MM-DD HH24:MI');
END;
$function$;
