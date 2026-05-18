-- Composite-key retrofit pilot #3 — `employee_schedule`.
--
-- Drop the surrogate `employee_schedule_id` UUID and promote the
-- existing UNIQUE (tenant_id, employee_id, shift_date) to be the PK.
--
-- Borderline call under CLAUDE.md's "Composite / natural keys preferred"
-- rule, which says 3+ column natural keys are a *reason* to use a
-- surrogate. The exception applies here because:
--
--   1. All three columns are immutable per row:
--      - tenant_id: never changes (rows don't move tenants).
--      - employee_id: the row IS the schedule of a specific employee.
--      - shift_date: the row IS the schedule for a specific date.
--      Changing any of those three means deleting + re-inserting a
--      different row, not updating the existing one.
--
--   2. The UNIQUE (tenant_id, employee_id, shift_date) constraint
--      has been the authoritative identity since the table existed —
--      every booking RPC (book_appointment_atomic, get_effective_shifts)
--      and every UI lookup keys on it. The surrogate has never been a
--      foreign-key target from any other table (grep -rn "REFERENCES
--      employee_schedule" returns zero), so the schema doesn't depend
--      on it being stable.
--
--   3. The two routes that did key on the surrogate
--      (POST /shifts/overrides/:id/update, DELETE /shifts/overrides/:id)
--      are rewritten in the same commit to take (employee_id, shift_date)
--      as path segments. The :update route has zero production callers
--      from the dashboard (`Api.shifts.schedule` only uses .save() which
--      hits /create — an UPSERT — and .remove() which becomes
--      DELETE /shifts/overrides/<employee>/<date>).
--
-- Migration order matches pilots #1 and #2: drop UNIQUE → drop old PK
-- → drop surrogate column → add composite PK.

-- Note: the existing PK constraint is named `shift_overrides_pkey`
-- (legacy from when this table was called shift_overrides — renamed to
-- employee_schedule 2026-04-30 via migration 20260430000000, which
-- didn't rename the underlying constraint). We name the replacement
-- with the modern table name for consistency.

ALTER TABLE employee_schedule
    DROP CONSTRAINT employee_schedule_tenant_id_employee_id_shift_date_key;

ALTER TABLE employee_schedule
    DROP CONSTRAINT shift_overrides_pkey;

ALTER TABLE employee_schedule
    DROP COLUMN employee_schedule_id;

ALTER TABLE employee_schedule
    ADD CONSTRAINT employee_schedule_pkey PRIMARY KEY (tenant_id, employee_id, shift_date);

-- The get_effective_shifts and get_effective_shifts_bulk RPCs selected
-- employee_schedule_id AS override_id. The surrogate is gone, so the
-- RPCs need updating. Callers that previously read override_id to
-- construct a delete URL now key on (employee_id, shift_date) directly
-- (which the same row already carries). Dropping the column from the
-- return type is cleaner than substituting a sentinel.
--
-- DROP + CREATE because Postgres doesn't allow changing a function's
-- return type via CREATE OR REPLACE.

DROP FUNCTION IF EXISTS public.get_effective_shifts(uuid, uuid, date, date);
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

DROP FUNCTION IF EXISTS public.get_effective_shifts_bulk(uuid, date, date);
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
