-- 20260702000000_cancel_orphaned_appointments_of_deleted_customers.sql
--
-- One-time backfill for the customer-delete orphaned-appointments bug
-- (docs/TODO.md, reported 2026-07-01 — e.g. "Ab Smith" on prod).
--
-- Customer delete became a soft-delete (PR #146), but the schedule/list
-- queries join customers WHERE is_deleted = false — so a deleted customer's
-- future 'scheduled' appointments vanished from every view while still
-- holding their slot (status='scheduled' feeds the GiST exclusion
-- constraints). Invisible, uncancelable ghosts.
--
-- The route fix (same PR as this migration) cancels a customer's UPCOMING
-- scheduled appointments inside the delete transaction going forward. This
-- migration cleans up the rows orphaned BEFORE that fix landed: cancel the
-- upcoming scheduled appointments of already-soft-deleted customers.
-- Past/completed appointments are untouched (history/analytics), matching
-- the route's rule. Data-only — no schema change, no baseline regen needed.

UPDATE appointments a
   SET status = 'canceled'
  FROM customers c
 WHERE c.customer_id = a.customer_id
   AND c.tenant_id = a.tenant_id
   AND c.is_deleted = true
   AND a.status = 'scheduled'
   AND a.start_time > now()
   AND (a.is_deleted IS NULL OR a.is_deleted = false);
