-- Coverage gap detection: determines which services are fully covered,
-- partially covered, or uncovered based on employee shifts and assignments.
--
-- Returns one row per service with coverage status and gap details.

CREATE OR REPLACE FUNCTION check_coverage_gaps(
    p_tenant_id UUID,
    p_start_date DATE DEFAULT CURRENT_DATE,
    p_end_date DATE DEFAULT NULL
) RETURNS TABLE (
    service_id UUID,
    service_name TEXT,
    duration_minutes INTEGER,
    coverage_status TEXT,       -- 'full', 'partial', 'uncovered', 'no_staff', 'no_resource'
    total_open_hours NUMERIC,
    covered_hours NUMERIC,
    gap_hours NUMERIC,
    has_qualified_staff BOOLEAN,
    has_capable_resource BOOLEAN,
    qualified_employee_count INTEGER,
    capable_resource_count INTEGER,
    gap_details JSONB           -- array of { date, day_name, gap_start, gap_end }
) AS $$
DECLARE
    v_tenant_tz TEXT;
    v_end_date DATE;
BEGIN
    -- Get tenant timezone
    SELECT COALESCE(t.timezone, 'UTC') INTO v_tenant_tz
    FROM tenants t WHERE t.id = p_tenant_id;
    IF v_tenant_tz IS NULL THEN v_tenant_tz := 'UTC'; END IF;

    -- Default end_date to 7 days from start
    v_end_date := COALESCE(p_end_date, p_start_date + INTERVAL '6 days');

    RETURN QUERY
    WITH
    -- Generate each date in the range
    date_series AS (
        SELECT d::DATE AS check_date,
               EXTRACT(DOW FROM d)::INTEGER AS dow
        FROM generate_series(p_start_date::TIMESTAMP, v_end_date::TIMESTAMP, '1 day') d
    ),

    -- All active services for this tenant
    tenant_services AS (
        SELECT s.id AS sid, s.name AS sname, s.duration_minutes AS sdur
        FROM services s
        WHERE s.tenant_id = p_tenant_id
    ),

    -- Count qualified employees per service (via service_employee mapping)
    staff_counts AS (
        SELECT se.service_id AS sid,
               COUNT(DISTINCT se.employee_id)::INTEGER AS emp_count
        FROM service_employee se
        JOIN employees e ON e.id = se.employee_id
        WHERE e.tenant_id = p_tenant_id
          AND e.is_active = true
          AND e.is_deleted = false
        GROUP BY se.service_id
    ),

    -- Count capable resources per service (via service_resource mapping)
    resource_counts AS (
        SELECT sr.service_id AS sid,
               COUNT(DISTINCT sr.resource_id)::INTEGER AS res_count
        FROM service_resource sr
        JOIN resources r ON r.id = sr.resource_id
        WHERE r.tenant_id = p_tenant_id
          AND r.is_active = true
          AND r.is_deleted = false
        GROUP BY sr.service_id
    ),

    -- For each service + date, find which hours are covered by at least one qualified employee on shift.
    -- "Business hours" for a day = the union of all employee shifts on that day for employees assigned to the service.
    -- We generate hourly slots and check if any qualified employee has a shift covering that hour.
    hourly_coverage AS (
        SELECT
            ts.sid,
            ds.check_date,
            ds.dow,
            h.hr,
            -- Is this hour covered by at least one qualified employee's shift?
            CASE WHEN EXISTS (
                SELECT 1
                FROM service_employee se
                JOIN employees e ON e.id = se.employee_id
                JOIN employee_shifts es ON es.employee_id = e.id
                WHERE se.service_id = ts.sid
                  AND e.tenant_id = p_tenant_id
                  AND e.is_active = true
                  AND e.is_deleted = false
                  AND es.day_of_week = ds.dow
                  AND es.is_active = true
                  AND es.start_time <= make_time(h.hr, 0, 0)
                  AND es.end_time > make_time(h.hr, 0, 0)
            ) THEN true ELSE false END AS is_covered
        FROM tenant_services ts
        CROSS JOIN date_series ds
        CROSS JOIN generate_series(0, 23) AS h(hr)
    ),

    -- Determine the "open hours" for each day: hours where ANY employee of the tenant is on shift.
    -- This defines the business's operating window (since there are no tenant-level business hours).
    open_hours AS (
        SELECT
            ds.check_date,
            ds.dow,
            h.hr
        FROM date_series ds
        CROSS JOIN generate_series(0, 23) AS h(hr)
        WHERE EXISTS (
            SELECT 1 FROM employee_shifts es
            JOIN employees e ON e.id = es.employee_id
            WHERE e.tenant_id = p_tenant_id
              AND e.is_active = true
              AND e.is_deleted = false
              AND es.day_of_week = ds.dow
              AND es.is_active = true
              AND es.start_time <= make_time(h.hr, 0, 0)
              AND es.end_time > make_time(h.hr, 0, 0)
        )
    ),

    -- Per-service coverage stats: only count hours that fall within open hours
    service_coverage AS (
        SELECT
            hc.sid,
            COUNT(*) FILTER (WHERE oh.hr IS NOT NULL)::NUMERIC AS total_open,
            COUNT(*) FILTER (WHERE oh.hr IS NOT NULL AND hc.is_covered)::NUMERIC AS total_covered,
            COUNT(*) FILTER (WHERE oh.hr IS NOT NULL AND NOT hc.is_covered)::NUMERIC AS total_gaps
        FROM hourly_coverage hc
        LEFT JOIN open_hours oh ON oh.check_date = hc.check_date AND oh.hr = hc.hr
        GROUP BY hc.sid
    ),

    -- Collect gap details as JSONB for each service
    gap_detail_agg AS (
        SELECT
            hc.sid,
            COALESCE(jsonb_agg(
                jsonb_build_object(
                    'date', hc.check_date,
                    'day_name', to_char(hc.check_date, 'Dy'),
                    'gap_start', make_time(hc.hr, 0, 0)::TEXT,
                    'gap_end', make_time(hc.hr + 1, 0, 0)::TEXT
                ) ORDER BY hc.check_date, hc.hr
            ) FILTER (WHERE oh.hr IS NOT NULL AND NOT hc.is_covered), '[]'::JSONB) AS gaps
        FROM hourly_coverage hc
        LEFT JOIN open_hours oh ON oh.check_date = hc.check_date AND oh.hr = hc.hr
        GROUP BY hc.sid
    )

    -- Final result
    SELECT
        ts.sid AS service_id,
        ts.sname AS service_name,
        ts.sdur AS duration_minutes,
        CASE
            WHEN COALESCE(sc2.emp_count, 0) = 0 THEN 'no_staff'
            WHEN COALESCE(rc.res_count, 0) = 0 THEN 'no_resource'
            WHEN COALESCE(cov.total_open, 0) = 0 THEN 'uncovered'
            WHEN cov.total_gaps = 0 THEN 'full'
            WHEN cov.total_covered > 0 THEN 'partial'
            ELSE 'uncovered'
        END AS coverage_status,
        COALESCE(cov.total_open, 0) AS total_open_hours,
        COALESCE(cov.total_covered, 0) AS covered_hours,
        COALESCE(cov.total_gaps, 0) AS gap_hours,
        COALESCE(sc2.emp_count, 0) > 0 AS has_qualified_staff,
        COALESCE(rc.res_count, 0) > 0 AS has_capable_resource,
        COALESCE(sc2.emp_count, 0) AS qualified_employee_count,
        COALESCE(rc.res_count, 0) AS capable_resource_count,
        COALESCE(gd.gaps, '[]'::JSONB) AS gap_details
    FROM tenant_services ts
    LEFT JOIN staff_counts sc2 ON sc2.sid = ts.sid
    LEFT JOIN resource_counts rc ON rc.sid = ts.sid
    LEFT JOIN service_coverage cov ON cov.sid = ts.sid
    LEFT JOIN gap_detail_agg gd ON gd.sid = ts.sid
    ORDER BY
        CASE
            WHEN COALESCE(sc2.emp_count, 0) = 0 THEN 0
            WHEN COALESCE(rc.res_count, 0) = 0 THEN 1
            WHEN COALESCE(cov.total_gaps, 0) > 0 THEN 2
            ELSE 3
        END,
        ts.sname;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant to api_user so it can be called via the backend
GRANT EXECUTE ON FUNCTION check_coverage_gaps(UUID, DATE, DATE) TO api_user;
