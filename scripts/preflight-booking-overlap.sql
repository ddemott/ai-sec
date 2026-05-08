-- Pre-flight scan for migration 20260501000000_atomic_booking_exclusion_constraints.sql
--
-- WHY this exists. The migration adds two GiST exclusion constraints to
-- the `appointments` table. ALTER TABLE ADD CONSTRAINT EXCLUDE validates
-- the new constraint against every existing row at creation time. If any
-- two existing rows already overlap, the ALTER fails and the migration
-- aborts — leaving prod in a known-good state, but with the migration
-- still pending.
--
-- This script finds those conflicts BEFORE the ALTER runs, so they can
-- be reconciled (cancel one, soft-delete one, or adjust times) and the
-- migration can apply cleanly.
--
-- The constraints being added:
--
--   appointments_no_resource_overlap
--     EXCLUDE USING gist (
--       resource_id WITH =,
--       tstzrange(start_time, end_time, '[)') WITH &&
--     )
--     WHERE (status = 'scheduled' AND (is_deleted IS NULL OR is_deleted = false))
--
--   appointments_no_employee_overlap
--     EXCLUDE USING gist (
--       employee_id WITH =,
--       tstzrange(start_time, end_time, '[)') WITH &&
--     )
--     WHERE (employee_id IS NOT NULL
--            AND status = 'scheduled'
--            AND (is_deleted IS NULL OR is_deleted = false))
--
-- Range model: half-open [start_time, end_time). Adjacent appointments
-- (10:00–10:30 followed by 10:30–11:00) do NOT overlap and are fine.
-- Zero-duration rows (start_time = end_time) produce an empty range and
-- do not overlap with anything.
-- NULL start_time or end_time produces an unbounded range that overlaps
-- with everything — these are flagged separately below.
--
-- HOW to run
--   set -a && . .env.production && set +a
--   psql "$DATABASE_URL" -f scripts/preflight-booking-overlap.sql
--
-- Read-only. Safe to run repeatedly against any environment.

\timing off
\pset pager off

\echo '====================================================================='
\echo '=== 1. Sanity: NULL start_time or end_time on eligible rows'
\echo '====================================================================='
\echo '(Either NULL produces an unbounded tstzrange that overlaps everything;'
\echo ' the EXCLUDE constraint would block it. Reconcile any rows that show.)'
\echo ''

SELECT id, tenant_id, resource_id, employee_id, status, is_deleted,
       start_time, end_time
FROM appointments
WHERE status = 'scheduled'
  AND (is_deleted IS NULL OR is_deleted = false)
  AND (start_time IS NULL OR end_time IS NULL)
ORDER BY tenant_id, id;

\echo ''
\echo '====================================================================='
\echo '=== 2. Resource-overlap scan (appointments_no_resource_overlap)'
\echo '====================================================================='

WITH eligible AS (
    SELECT id, tenant_id, resource_id, employee_id, customer_id,
           start_time, end_time,
           tstzrange(start_time, end_time, '[)') AS rng
    FROM appointments
    WHERE status = 'scheduled'
      AND (is_deleted IS NULL OR is_deleted = false)
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
)
SELECT count(*) AS conflicting_resource_pairs
FROM eligible a
JOIN eligible b
  ON a.id < b.id
 AND a.resource_id = b.resource_id
 AND a.rng && b.rng;

\echo ''
\echo '--- Resource conflicts: first 50 pairs (a.id < b.id; same resource_id; ranges overlap) ---'
\echo ''

WITH eligible AS (
    SELECT id, tenant_id, resource_id, employee_id, customer_id,
           start_time, end_time,
           tstzrange(start_time, end_time, '[)') AS rng
    FROM appointments
    WHERE status = 'scheduled'
      AND (is_deleted IS NULL OR is_deleted = false)
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
)
SELECT a.tenant_id,
       a.resource_id,
       a.id            AS a_id,
       a.start_time    AS a_start,
       a.end_time      AS a_end,
       a.customer_id   AS a_customer,
       b.id            AS b_id,
       b.start_time    AS b_start,
       b.end_time      AS b_end,
       b.customer_id   AS b_customer
FROM eligible a
JOIN eligible b
  ON a.id < b.id
 AND a.resource_id = b.resource_id
 AND a.rng && b.rng
ORDER BY a.tenant_id, a.resource_id, a.start_time
LIMIT 50;

\echo ''
\echo '====================================================================='
\echo '=== 3. Employee-overlap scan (appointments_no_employee_overlap)'
\echo '====================================================================='

WITH eligible AS (
    SELECT id, tenant_id, resource_id, employee_id, customer_id,
           start_time, end_time,
           tstzrange(start_time, end_time, '[)') AS rng
    FROM appointments
    WHERE status = 'scheduled'
      AND (is_deleted IS NULL OR is_deleted = false)
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND employee_id IS NOT NULL
)
SELECT count(*) AS conflicting_employee_pairs
FROM eligible a
JOIN eligible b
  ON a.id < b.id
 AND a.employee_id = b.employee_id
 AND a.rng && b.rng;

\echo ''
\echo '--- Employee conflicts: first 50 pairs (a.id < b.id; same employee_id; ranges overlap) ---'
\echo ''

WITH eligible AS (
    SELECT id, tenant_id, resource_id, employee_id, customer_id,
           start_time, end_time,
           tstzrange(start_time, end_time, '[)') AS rng
    FROM appointments
    WHERE status = 'scheduled'
      AND (is_deleted IS NULL OR is_deleted = false)
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
      AND employee_id IS NOT NULL
)
SELECT a.tenant_id,
       a.employee_id,
       a.id            AS a_id,
       a.start_time    AS a_start,
       a.end_time      AS a_end,
       a.customer_id   AS a_customer,
       b.id            AS b_id,
       b.start_time    AS b_start,
       b.end_time      AS b_end,
       b.customer_id   AS b_customer
FROM eligible a
JOIN eligible b
  ON a.id < b.id
 AND a.employee_id = b.employee_id
 AND a.rng && b.rng
ORDER BY a.tenant_id, a.employee_id, a.start_time
LIMIT 50;

\echo ''
\echo '====================================================================='
\echo 'Verdict'
\echo '====================================================================='
\echo 'If both counts above are 0 AND section (1) returned no rows, the'
\echo 'migration ALTERs will succeed cleanly.'
\echo ''
\echo 'If any pair is listed, reconcile by either:'
\echo '  - UPDATE appointments SET status = ''cancelled'' WHERE id = <one_of_the_pair>;'
\echo '  - UPDATE appointments SET is_deleted = true WHERE id = <one_of_the_pair>;'
\echo '  - UPDATE appointments SET start_time = ..., end_time = ... WHERE id = <one>;'
\echo 'so the half-open ranges no longer overlap. Re-run this scan until both counts are 0.'
\echo '====================================================================='
