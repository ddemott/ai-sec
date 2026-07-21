-- PROD test-appointment cleanup — 2026-07-21.
-- All 14 'scheduled' appointments in prod are test data (fake / test-verification
-- numbers, no real customers pre-launch). Pick ONE option, review, then run.
--
-- SOFT (recommended): status -> 'canceled' keeps the row + audit trail, and the
-- dashboard's Cancelled count reflects it. HARD DELETE removes the rows entirely.
--
-- Run against PROD:
--   psql "$PROD_URL" -v ON_ERROR_STOP=1 -f scripts/cleanup-test-appointments.sql
-- (decrypt PROD_URL from the stashed db_url.enc first; never paste it inline)

-- Preview the blast radius FIRST — run this SELECT alone before uncommenting anything.
SELECT a.appointment_id, a.start_time AT TIME ZONE 'America/Chicago' AS local_time,
       a.status, c.name, c.phone
FROM appointments a JOIN customers c USING (customer_id)
WHERE a.status = 'scheduled'
ORDER BY a.start_time;

-- ── OPTION A — just the two duplicate Neil bookings (the ones you flagged) ──────
-- UPDATE appointments SET status = 'canceled'
-- WHERE appointment_id IN (
--   '28d9905d-3f93-4484-8a05-b80c6536ad80',  -- Neil 7/21 3:00 PM
--   '603a0bda-77ab-439d-8400-b33b9da6b6db'   -- Neil 7/21 3:30 PM
-- );

-- ── OPTION B — clean slate: cancel EVERY scheduled test appointment ─────────────
-- All 14 are test data; this soft-cancels them so the schedule is empty for a
-- real launch. Customers rows are left intact (harmless; identify_caller reuses
-- them). Flip to DELETE only if you want the rows physically gone.
-- UPDATE appointments SET status = 'canceled' WHERE status = 'scheduled';

-- ── OPTION B' — HARD delete instead of cancel (rows gone entirely) ──────────────
-- DELETE FROM appointments WHERE status = 'scheduled';
