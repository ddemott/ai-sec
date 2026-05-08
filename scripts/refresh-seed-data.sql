-- One-shot cleanup of stale DynaTire test/seed data + orphan records.
--
-- Surfaced by scripts/audit-test-data.sql (2026-05-08): three appointments
-- 35-37 days past still in `status='scheduled'`, an orphan customer in
-- the super-admin tenant left over from an early multi-tenant probe,
-- and DynaTire's employee_schedule expired (last shift 2026-04-24, no
-- coverage in the current 2-week window so any future booking would
-- fail with EMPLOYEE_NOT_SCHEDULED).
--
-- Idempotent — UPDATEs match by id (no-op if already cleaned),
-- DELETE matches by id (no-op if already gone), shift INSERTs use
-- ON CONFLICT DO UPDATE so re-runs refresh hours instead of erroring.
-- Wrapped in a single transaction so partial failure rolls back.
--
-- Usage:
--   set -a && . .env.production && set +a
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/refresh-seed-data.sql

\timing off
\pset pager off

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Close out stale "scheduled" appointments
-- ─────────────────────────────────────────────────────────────────────
-- Three appointments from 2026-03-31 and 2026-04-02 are still tagged
-- 'scheduled' despite being 35+ days in the past. Realistically the
-- customer either showed up (status='completed') or didn't (status=
-- 'no_show'). Without history we can't distinguish per-row, but
-- 'completed' is the more common outcome for tire-shop test data and
-- the safer default — analytics that count "missed bookings" won't
-- spike from these legacy rows. Specific ids match the audit output;
-- if a real history record surfaces later, individual rows can be
-- corrected.
UPDATE appointments
   SET status = 'completed'
 WHERE id IN (
     'e124589c-0c3e-4a05-8ed4-117a1eb43156', -- 2026-03-31 Flat tire repair
     '19a0a75c-d8ff-43dc-b987-d2195f627fd6', -- 2026-03-31 Tire rotation
     'fd96434f-82a0-4418-86c1-e80223f8200a'  -- 2026-04-02 Tire rotation test (Mike)
   )
   AND status = 'scheduled';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Delete the "Wrong Tenant" orphan customer
-- ─────────────────────────────────────────────────────────────────────
-- Created 2026-03-30 18:11:59 UTC in the super-admin tenant
-- (00000000-...) — name literally "Wrong Tenant", phone +15555550008,
-- no email. Residue from an early multi-tenant isolation probe that
-- didn't roll back. No appointments / call_summaries / consent_records
-- reference this id (verified by the audit). Hard delete: this row
-- should never have existed in production.
DELETE FROM customers
 WHERE id = '0ab6d05f-1502-46f0-a30c-6fc2a3f00d13';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Refresh DynaTire shift coverage for the current 2-week window
-- ─────────────────────────────────────────────────────────────────────
-- Mirrors supabase/seed.sql lines 122-148 — but with ON CONFLICT
-- DO UPDATE so a re-run rotates the hours forward without erroring.
-- Hours match the seed: Mike 07:00-16:00, Carlos 08:00-17:00, Dana
-- 09:00-18:00. Mon-Fri only (skips weekends).
DO $$
DECLARE
    v_mike_id   UUID;
    v_carlos_id UUID;
    v_dana_id   UUID;
    v_tenant    UUID := 'f234e471-0e60-4163-86c9-93cfd9338e3a';
    v_day       DATE;
    v_start     DATE;
    v_end       DATE;
BEGIN
    SELECT id INTO v_mike_id   FROM employees WHERE name = 'Mike Rivera'  AND tenant_id = v_tenant;
    SELECT id INTO v_carlos_id FROM employees WHERE name = 'Carlos Vega'  AND tenant_id = v_tenant;
    SELECT id INTO v_dana_id   FROM employees WHERE name = 'Dana Okafor'  AND tenant_id = v_tenant;

    -- this Monday → next-week Friday (12 calendar days, 10 weekdays)
    v_start := CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::INT + 1;
    v_end   := v_start + 11;

    v_day := v_start;
    WHILE v_day <= v_end LOOP
        IF EXTRACT(DOW FROM v_day) NOT IN (0, 6) THEN
            -- Mike Rivera: 07:00-16:00
            INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
            VALUES (v_tenant, v_mike_id, v_day, '07:00', '16:00', false)
            ON CONFLICT (tenant_id, employee_id, shift_date) DO UPDATE
                SET start_time = EXCLUDED.start_time,
                    end_time   = EXCLUDED.end_time,
                    is_off     = false;

            -- Carlos Vega: 08:00-17:00
            INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
            VALUES (v_tenant, v_carlos_id, v_day, '08:00', '17:00', false)
            ON CONFLICT (tenant_id, employee_id, shift_date) DO UPDATE
                SET start_time = EXCLUDED.start_time,
                    end_time   = EXCLUDED.end_time,
                    is_off     = false;

            -- Dana Okafor: 09:00-18:00
            INSERT INTO employee_schedule (tenant_id, employee_id, shift_date, start_time, end_time, is_off)
            VALUES (v_tenant, v_dana_id, v_day, '09:00', '18:00', false)
            ON CONFLICT (tenant_id, employee_id, shift_date) DO UPDATE
                SET start_time = EXCLUDED.start_time,
                    end_time   = EXCLUDED.end_time,
                    is_off     = false;
        END IF;
        v_day := v_day + 1;
    END LOOP;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- Post-apply verification
-- ─────────────────────────────────────────────────────────────────────
\echo '--- stale appointments after cleanup (should be 0) ---'
SELECT count(*) AS stale_scheduled
  FROM appointments
 WHERE status = 'scheduled'
   AND is_deleted = false
   AND end_time < NOW() - INTERVAL '7 days';

\echo '--- orphan super-admin customers after cleanup (should be 0) ---'
SELECT count(*) AS super_admin_customers
  FROM customers
 WHERE tenant_id = '00000000-0000-0000-0000-000000000000'
   AND is_deleted = false;

\echo '--- DynaTire shift coverage (next 14 days, expect ~30 rows = 10 weekdays × 3 employees) ---'
SELECT count(*) AS upcoming_shift_rows
  FROM employee_schedule
 WHERE tenant_id = 'f234e471-0e60-4163-86c9-93cfd9338e3a'
   AND shift_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 14
   AND is_off = false;
