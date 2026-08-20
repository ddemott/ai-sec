-- Reminder claim status: allow 'sending', and make an abandoned claim recoverable.
--
-- WHAT BROKE. On 2026-08-06 (#322, 6d94cf9) the reminder worker gained an atomic
-- claim to stop a mid-deploy double-text:
--
--     UPDATE reminder_schedules SET status = 'sending' ... FOR UPDATE SKIP LOCKED
--
-- `reminder_schedules_status_check` has never allowed 'sending'. It permits only
-- scheduled | sent | failed | cancelled. So the claim raised
--
--     new row for relation "reminder_schedules" violates check constraint
--     "reminder_schedules_status_check"
--
-- on EVERY tick. The exception landed in processBatch()'s outer catch, which
-- increments errors_total{event="reminder_batch_failed"} and returns 0. The worker
-- kept ticking, /health stayed green, and NOT ONE REMINDER WAS SENT for 13 days.
-- Nothing else surfaced it: the only signal was a counter on the token-gated
-- /metrics endpoint that nothing scrapes, and the fix that introduced it was a
-- reliability fix, so its own unit tests mocked the pool and could not see a CHECK
-- constraint. Reproduced against real Postgres before writing this file.
--
-- No backfill is needed, and that is the one piece of luck here: because the
-- constraint rejected the write, no row was ever left in a bad state. The outage
-- was total, not partial.
--
-- WHY 'sending' EARNS ITS PLACE IN THE ENUM. The claim is the fix for a real
-- double-text on every Railway deploy (SIGTERM lands mid-batch, after Telnyx
-- accepted the message and before the row flipped to 'sent'). That needs a state
-- meaning "a worker owns this row right now", distinct from both 'scheduled'
-- (free to claim) and 'sent' (delivered). Widening the enum is the honest fix;
-- dropping the claim would restore the double-text.
--
-- WHY THE RECOVERY INDEX. 'sending' introduces a way to LOSE a reminder that
-- 'scheduled' never had: the claim query only ever selects status = 'scheduled',
-- so a row claimed by a worker that then dies — SIGTERM past the drain timeout,
-- OOM, pod eviction — is invisible to every future tick, forever. That trades a
-- loud total outage for a silent slow leak, which is worse. The worker now
-- releases stale claims back to 'scheduled' at the top of each batch; this
-- partial index is what keeps that sweep from scanning the whole table.

ALTER TABLE public.reminder_schedules
  DROP CONSTRAINT IF EXISTS reminder_schedules_status_check;

ALTER TABLE public.reminder_schedules
  ADD CONSTRAINT reminder_schedules_status_check
  CHECK (status::text = ANY (ARRAY[
    'scheduled'::text,
    'sending'::text,
    'sent'::text,
    'failed'::text,
    'cancelled'::text
  ]));

-- Supports the stale-claim release sweep (worker: releaseStaleClaims()).
-- Partial, because 'sending' is a transient state that should hold a handful of
-- rows for a few seconds at a time — if this index is ever large, the worker is
-- dying mid-batch and that is the thing to go fix.
CREATE INDEX IF NOT EXISTS idx_reminder_schedules_sending_updated_at
  ON public.reminder_schedules (updated_at)
  WHERE status::text = 'sending';

COMMENT ON COLUMN public.reminder_schedules.status IS
  'scheduled = free to claim | sending = a worker holds this row right now (atomic claim; released back to scheduled if stale) | sent | failed | cancelled';
