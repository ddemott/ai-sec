-- Renames employee_schedule.id → employee_schedule_id.
--
-- Pilot #13 of the PK naming convention conversion (per CODING_STANDARDS.md).
-- Smallest remaining scope:
--   - employee_schedule has zero inbound FKs (no other table points at
--     employee_schedule.id), and is not on the auto_version_trigger or
--     fn_audit_trigger CASE-mapped table lists — so no trigger CASE
--     extension required.
--   - 2 RPCs (`get_effective_shifts`, `get_effective_shifts_bulk`)
--     SELECT `es.id AS override_id`. The output-column alias
--     `override_id` is the consumer-facing public contract (dashboard's
--     `EffectiveShift.override_id`) and stays unchanged; only the
--     internal SELECT switches to the new column name.
--   - check_coverage_gaps + check_availability_with_tz JOIN
--     employee_schedule but reference employee_id / shift_date /
--     start_time / end_time / is_off — none of them touch the PK.
--     No rewrite needed there.

BEGIN;

ALTER TABLE employee_schedule RENAME COLUMN id TO employee_schedule_id;

-- ────────────────────────────────────────────────────────────────────
-- 1. get_effective_shifts — single employee, RPC alias preserved
-- ────────────────────────────────────────────────────────────────────
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
        es.shift_date,
        EXTRACT(DOW FROM es.shift_date)::INTEGER AS day_of_week,
        es.start_time,
        es.end_time,
        true AS is_override,
        es.is_off,
        es.employee_schedule_id AS override_id
    FROM employee_schedule es
    WHERE es.tenant_id = p_tenant_id
      AND es.employee_id = p_employee_id
      AND es.shift_date BETWEEN p_start_date AND p_end_date
    ORDER BY es.shift_date;
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- 2. get_effective_shifts_bulk — all employees, RPC alias preserved
-- ────────────────────────────────────────────────────────────────────
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
        es.employee_id,
        es.shift_date,
        EXTRACT(DOW FROM es.shift_date)::INTEGER AS day_of_week,
        es.start_time,
        es.end_time,
        true AS is_override,
        es.is_off,
        es.employee_schedule_id AS override_id
    FROM employee_schedule es
    WHERE es.tenant_id = p_tenant_id
      AND es.shift_date BETWEEN p_start_date AND p_end_date
    ORDER BY es.employee_id, es.shift_date;
END;
$$;

COMMIT;
