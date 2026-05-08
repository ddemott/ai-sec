-- Test-data audit for prod Supabase before applying the booking-constraint
-- migrations (20260501000000, 20260501000001, 20260507000000).
--
-- Premise: the new exclusion constraints + service-mapping enforcement
-- only protect against bad bookings going FORWARD. They do not validate
-- existing data. If the seed/test data already violates the invariants
-- the constraints encode, the migration's overlap scan returns "0
-- conflicts" only because the bad rows are also bad in OTHER ways
-- (status='scheduled' but the linked employee is soft-deleted, etc.) —
-- and the post-migration system would still produce confusing results.
--
-- This audit checks every invariant the new code path assumes, even the
-- ones that aren't ALTER-blocking. A failing check here means: clean the
-- data first, OR re-evaluate whether the invariant is actually meant to
-- hold.
--
-- Read-only. Safe to run repeatedly.
--
--   set -a && . .env.production && set +a
--   psql "$DATABASE_URL" -f scripts/audit-test-data.sql

\timing off
\pset pager off

\echo '====================================================================='
\echo '=== 0. Inventory: every scheduled appointment in prod'
\echo '====================================================================='
SELECT a.id, t.name AS tenant, a.start_time, a.end_time,
       r.name AS resource,
       e.name AS employee,
       c.name AS customer,
       a.description, a.status, a.is_deleted
FROM appointments a
JOIN tenants t ON t.id = a.tenant_id
LEFT JOIN resources r ON r.id = a.resource_id
LEFT JOIN employees e ON e.id = a.employee_id
LEFT JOIN customers c ON c.id = a.customer_id
ORDER BY t.name, a.start_time;

\echo ''
\echo '====================================================================='
\echo '=== A. Time integrity'
\echo '====================================================================='

\echo '--- A1. start_time >= end_time (zero or negative duration) ---'
SELECT id, tenant_id, start_time, end_time,
       EXTRACT(EPOCH FROM (end_time - start_time)) AS seconds
FROM appointments
WHERE status = 'scheduled' AND is_deleted = false
  AND start_time >= end_time;

\echo ''
\echo '--- A2. Implausible dates (more than 2 years from now) ---'
SELECT id, tenant_id, start_time, end_time
FROM appointments
WHERE status = 'scheduled' AND is_deleted = false
  AND (start_time < now() - interval '2 years'
    OR start_time > now() + interval '2 years');

\echo ''
\echo '--- A3. Past appointments still status=scheduled (should be completed/no_show?) ---'
SELECT id, tenant_id, start_time, end_time,
       EXTRACT(DAY FROM (now() - end_time)) AS days_overdue
FROM appointments
WHERE status = 'scheduled' AND is_deleted = false
  AND end_time < now()
ORDER BY end_time;

\echo ''
\echo '====================================================================='
\echo '=== B. Tenant boundary integrity'
\echo '====================================================================='

\echo '--- B1. Resource tenant != appointment tenant ---'
SELECT a.id AS appt_id, a.tenant_id AS appt_tenant, r.tenant_id AS resource_tenant
FROM appointments a JOIN resources r ON r.id = a.resource_id
WHERE a.status = 'scheduled' AND a.is_deleted = false
  AND a.tenant_id != r.tenant_id;

\echo ''
\echo '--- B2. Employee tenant != appointment tenant (when employee set) ---'
SELECT a.id AS appt_id, a.tenant_id AS appt_tenant, e.tenant_id AS employee_tenant
FROM appointments a JOIN employees e ON e.id = a.employee_id
WHERE a.status = 'scheduled' AND a.is_deleted = false
  AND a.employee_id IS NOT NULL
  AND a.tenant_id != e.tenant_id;

\echo ''
\echo '--- B3. Customer tenant != appointment tenant ---'
SELECT a.id AS appt_id, a.tenant_id AS appt_tenant, c.tenant_id AS customer_tenant
FROM appointments a JOIN customers c ON c.id = a.customer_id
WHERE a.status = 'scheduled' AND a.is_deleted = false
  AND a.tenant_id != c.tenant_id;

\echo ''
\echo '====================================================================='
\echo '=== C. Reference integrity (no orphans, no soft-deleted parents)'
\echo '====================================================================='

\echo '--- C1. Resource missing or soft-deleted ---'
SELECT a.id AS appt_id, a.resource_id, r.is_deleted AS resource_is_deleted
FROM appointments a LEFT JOIN resources r ON r.id = a.resource_id
WHERE a.status = 'scheduled' AND a.is_deleted = false
  AND (r.id IS NULL OR r.is_deleted = true);

\echo ''
\echo '--- C2. Employee missing or soft-deleted (when employee set) ---'
SELECT a.id AS appt_id, a.employee_id, e.is_deleted AS employee_is_deleted
FROM appointments a LEFT JOIN employees e ON e.id = a.employee_id
WHERE a.status = 'scheduled' AND a.is_deleted = false
  AND a.employee_id IS NOT NULL
  AND (e.id IS NULL OR e.is_deleted = true);

\echo ''
\echo '--- C3. Customer missing or soft-deleted ---'
SELECT a.id AS appt_id, a.customer_id, c.is_deleted AS customer_is_deleted
FROM appointments a LEFT JOIN customers c ON c.id = a.customer_id
WHERE a.status = 'scheduled' AND a.is_deleted = false
  AND (c.id IS NULL OR c.is_deleted = true);

\echo ''
\echo '====================================================================='
\echo '=== D. Status hygiene'
\echo '====================================================================='

\echo '--- D1. Distinct status values (expected: scheduled, completed, cancelled, no_show) ---'
SELECT status, count(*)
FROM appointments
GROUP BY status ORDER BY count(*) DESC;

\echo ''
\echo '====================================================================='
\echo '=== E. Business-hours alignment (assigned employee on shift?)'
\echo '====================================================================='
\echo 'For every scheduled+assigned appointment, check that the employee'
\echo 'has an employee_schedule row covering the appointment time in the'
\echo "tenant's local timezone. This is what book_with_scheduling_atomic"
\echo 'enforces going forward — if any current row violates it, that row'
\echo 'could not be re-booked under the new code path.'
\echo ''

WITH eligible AS (
    SELECT a.id, a.tenant_id, a.employee_id, a.start_time, a.end_time,
           COALESCE(t.timezone, 'UTC') AS tz
    FROM appointments a JOIN tenants t ON t.id = a.tenant_id
    WHERE a.status = 'scheduled'
      AND a.is_deleted = false
      AND a.employee_id IS NOT NULL
)
SELECT e.id AS appt_id, e.tenant_id, e.employee_id, e.tz,
       e.start_time, e.end_time,
       (e.start_time AT TIME ZONE e.tz)::DATE AS local_date,
       (e.start_time AT TIME ZONE e.tz)::TIME AS local_start,
       (e.end_time   AT TIME ZONE e.tz)::TIME AS local_end
FROM eligible e
WHERE NOT EXISTS (
    SELECT 1 FROM employee_schedule s
    WHERE s.employee_id = e.employee_id
      AND s.tenant_id = e.tenant_id
      AND s.shift_date = (e.start_time AT TIME ZONE e.tz)::DATE
      AND s.is_off = false
      AND s.start_time <= (e.start_time AT TIME ZONE e.tz)::TIME
      AND s.end_time   >= (e.end_time   AT TIME ZONE e.tz)::TIME
);

\echo ''
\echo '====================================================================='
\echo '=== F. Concurrency hygiene (overlap)'
\echo '====================================================================='

\echo '--- F1. Resource overlap (the new constraint) ---'
WITH eligible AS (
    SELECT id, tenant_id, resource_id, start_time, end_time,
           tstzrange(start_time, end_time, '[)') AS rng
    FROM appointments
    WHERE status = 'scheduled' AND is_deleted = false
)
SELECT a.tenant_id, a.resource_id,
       a.id AS a_id, a.start_time AS a_start, a.end_time AS a_end,
       b.id AS b_id, b.start_time AS b_start, b.end_time AS b_end
FROM eligible a JOIN eligible b
  ON a.id < b.id AND a.resource_id = b.resource_id AND a.rng && b.rng;

\echo ''
\echo '--- F2. Employee overlap (the new constraint) ---'
WITH eligible AS (
    SELECT id, tenant_id, employee_id, start_time, end_time,
           tstzrange(start_time, end_time, '[)') AS rng
    FROM appointments
    WHERE status = 'scheduled' AND is_deleted = false AND employee_id IS NOT NULL
)
SELECT a.tenant_id, a.employee_id,
       a.id AS a_id, a.start_time AS a_start, a.end_time AS a_end,
       b.id AS b_id, b.start_time AS b_start, b.end_time AS b_end
FROM eligible a JOIN eligible b
  ON a.id < b.id AND a.employee_id = b.employee_id AND a.rng && b.rng;

\echo ''
\echo '--- F3. Customer overlap (one person in two places at once) ---'
\echo '(Not enforced by a constraint, but a real-world tell on bad data.)'
WITH eligible AS (
    SELECT id, tenant_id, customer_id, start_time, end_time,
           tstzrange(start_time, end_time, '[)') AS rng
    FROM appointments
    WHERE status = 'scheduled' AND is_deleted = false
)
SELECT a.tenant_id, a.customer_id,
       a.id AS a_id, a.start_time AS a_start, a.end_time AS a_end,
       b.id AS b_id, b.start_time AS b_start, b.end_time AS b_end
FROM eligible a JOIN eligible b
  ON a.id < b.id AND a.customer_id = b.customer_id AND a.rng && b.rng;

\echo ''
\echo '====================================================================='
\echo '=== G. Schedule sanity'
\echo '====================================================================='

\echo '--- G1. employee_schedule rows where end_time <= start_time (and not is_off) ---'
SELECT id, employee_id, shift_date, start_time, end_time, is_off
FROM employee_schedule
WHERE is_off = false AND start_time >= end_time;

\echo ''
\echo '--- G2. employee_schedule pointing at missing or soft-deleted employees ---'
SELECT s.id, s.employee_id, e.is_deleted
FROM employee_schedule s LEFT JOIN employees e ON e.id = s.employee_id
WHERE e.id IS NULL OR e.is_deleted = true;

\echo ''
\echo '--- G3. employee_schedule shift_date wildly off (>1y past or >1y future) ---'
SELECT id, employee_id, shift_date
FROM employee_schedule
WHERE shift_date < CURRENT_DATE - INTERVAL '1 year'
   OR shift_date > CURRENT_DATE + INTERVAL '1 year';

\echo ''
\echo '====================================================================='
\echo '=== H. Per-tenant inventory'
\echo '====================================================================='
SELECT t.name AS tenant, t.timezone,
       (SELECT count(*) FROM resources         r WHERE r.tenant_id = t.id AND r.is_deleted = false) AS resources,
       (SELECT count(*) FROM employees         e WHERE e.tenant_id = t.id AND e.is_deleted = false) AS employees,
       (SELECT count(*) FROM customers         c WHERE c.tenant_id = t.id AND c.is_deleted = false) AS customers,
       (SELECT count(*) FROM services          s WHERE s.tenant_id = t.id AND s.is_deleted = false) AS services,
       (SELECT count(*) FROM employee_schedule s WHERE s.tenant_id = t.id AND s.is_off = false)     AS shifts,
       (SELECT count(*) FROM appointments      a WHERE a.tenant_id = t.id AND a.is_deleted = false AND a.status = 'scheduled') AS scheduled_appts
FROM tenants t
ORDER BY t.name;
