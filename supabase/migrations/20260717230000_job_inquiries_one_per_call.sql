-- At most ONE job inquiry per (tenant, call).
--
-- The job-intake rung's contract is "retry capture_job_inquiry until you hold
-- a job_inquiry_id" — so a slow response is retried, and on 2026-07-17 four
-- overlapping retries (each held 60-120s behind an unreachable SMTP send)
-- wrote four identical rows and stamped the appointment four times (PR #280).
-- The route now dedupes with a fast-path SELECT, but two in-flight requests
-- can both pass a SELECT before either INSERT commits. This index is the
-- layer that cannot race; the route pairs it with INSERT ... ON CONFLICT DO
-- NOTHING + a winner lookup. Same construction as
-- reminder_schedules_unique_scheduled_bundle (20260701010000): DB-level
-- idempotency, no advisory locks.
--
-- Partial on call_id IS NOT NULL: dashboard-entered or imported inquiries
-- without a call keep unlimited rows — the constraint is about RETRIES OF ONE
-- CALL, not about how many inquiries a tenant may have.
CREATE UNIQUE INDEX IF NOT EXISTS job_inquiries_one_per_call
  ON job_inquiries (tenant_id, call_id)
  WHERE call_id IS NOT NULL;
