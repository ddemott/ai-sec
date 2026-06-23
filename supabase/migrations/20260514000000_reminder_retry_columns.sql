-- Retry-on-failure support for the reminder worker.
--
-- WHY this exists. `src/workers/reminderScheduler.ts` previously marked
-- a reminder as `status='failed'` on the first send error and never
-- retried — meaning a single transient (legacy provider) 5xx or network blip lost
-- the reminder permanently. (Legacy SMS provider support removed 2026-06;
-- Telnyx is now sole provider.) Per docs/TODO.md "Retry logic for failed
-- sends": provider/email 5xx + network errors retry with exponential backoff;
-- 4xx (invalid number, blocked recipient, etc.) does NOT retry because the
-- same input will produce the same error.
--
-- WHAT the new columns mean.
--   retry_count    — how many retry attempts have already been spent.
--                    0 = original attempt has not yet failed. Counts up
--                    to MAX_RETRIES (3) before status flips to 'failed'.
--   next_retry_at  — the earliest timestamp the worker may pick this
--                    row up again. NULL = either the original attempt
--                    (not yet retried) or the row is in a terminal
--                    status. The worker's pickup query filters on
--                    `next_retry_at IS NULL OR next_retry_at <= NOW()`
--                    so retries don't fire before their backoff window.
--
-- Backoff schedule (lives in code, not schema):
--   1st retry: scheduled_for + 5 minutes
--   2nd retry: 1st-retry-time + 30 minutes
--   3rd retry: 2nd-retry-time + 2 hours
--   After 3rd retry fails: status = 'failed' permanently.
--
-- Index strategy. The existing `idx_reminder_schedules_status_scheduled_for`
-- partial index covers `(status, scheduled_for)` WHERE status='scheduled'.
-- That stays usable for the new query because Postgres can still use a
-- partial index when the WHERE clause is a superset of the predicate.
-- We add a tighter index on `(scheduled_for, next_retry_at)` so the
-- worker's batch pickup stays fast as the table grows.

BEGIN;

ALTER TABLE reminder_schedules
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;

ALTER TABLE reminder_schedules
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_reminder_schedules_pickup
  ON reminder_schedules (scheduled_for, next_retry_at)
  WHERE status = 'scheduled';

COMMIT;
