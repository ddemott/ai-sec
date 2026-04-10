-- Update both shift RPCs to date-based only (no weekly pattern fallback).
-- This aligns with the simplified scheduling model: click a day → set times → save.

-- Single-employee version (used by Working Hours view)
CREATE OR REPLACE FUNCTION get_effective_shifts(
    p_tenant_id UUID,
    p_employee_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE(
    shift_date DATE,
    day_of_week INTEGER,
    start_time TIME WITHOUT TIME ZONE,
    end_time TIME WITHOUT TIME ZONE,
    is_override BOOLEAN,
    is_off BOOLEAN,
    override_id UUID
)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    RETURN QUERY
    SELECT
        so.shift_date,
        EXTRACT(DOW FROM so.shift_date)::INTEGER AS day_of_week,
        so.start_time,
        so.end_time,
        true AS is_override,
        so.is_off,
        so.id AS override_id
    FROM shift_overrides so
    WHERE so.tenant_id = p_tenant_id
      AND so.employee_id = p_employee_id
      AND so.shift_date BETWEEN p_start_date AND p_end_date
    ORDER BY so.shift_date;
END;
$$;

-- Bulk version (used by Front Desk scheduler)
CREATE OR REPLACE FUNCTION get_effective_shifts_bulk(
    p_tenant_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE(
    employee_id UUID,
    shift_date DATE,
    day_of_week INTEGER,
    start_time TIME WITHOUT TIME ZONE,
    end_time TIME WITHOUT TIME ZONE,
    is_override BOOLEAN,
    is_off BOOLEAN,
    override_id UUID
)
LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    RETURN QUERY
    SELECT
        so.employee_id,
        so.shift_date,
        EXTRACT(DOW FROM so.shift_date)::INTEGER AS day_of_week,
        so.start_time,
        so.end_time,
        true AS is_override,
        so.is_off,
        so.id AS override_id
    FROM shift_overrides so
    WHERE so.tenant_id = p_tenant_id
      AND so.shift_date BETWEEN p_start_date AND p_end_date
    ORDER BY so.employee_id, so.shift_date;
END;
$$;
