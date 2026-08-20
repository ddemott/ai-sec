-- Remove the n8n appointment webhook: trigger, function, and column.
--
-- WHAT IT WAS: `trigger_notify_n8n_appointment AFTER INSERT ON appointments`
-- calling `notify_n8n_on_appointment()`, a SECURITY DEFINER function that reads
-- `tenants.n8n_webhook_url` and, when `pg_net` is available, POSTs the new
-- appointment to that URL.
--
-- WHY IT GOES:
--
-- 1. It has NO application surface. `n8n_webhook_url` has zero readers and zero
--    writers anywhere in the codebase — no route sets it, no dashboard field
--    edits it, no type declares it. The only occurrence of the string "n8n" in
--    TypeScript is an unrelated comment in src/routes/calendar.ts. There is no
--    way for an owner to configure this and no way to observe it working.
--
-- 2. It costs every booking a query it does not need. The function runs on
--    EVERY appointment INSERT and its first act is a SELECT against `tenants`,
--    inside the booking transaction, before discovering there is nothing to do.
--
-- 3. What it would do if finished is worse than what it does now. Install
--    `pg_net` and set a URL and the POST happens SYNCHRONOUSLY inside the
--    booking transaction — so `book_with_scheduling_atomic` would block on an
--    external host while holding the GiST exclusion constraints that make
--    booking race-safe. A slow or hanging webhook endpoint becomes a booking
--    outage. An integration that fires from inside the write path is not an
--    integration, it is a coupling.
--
-- VERIFIED AGAINST PROD BEFORE WRITING THIS: 0 tenants have a non-empty
-- `n8n_webhook_url`, and `pg_net` is not installed. So this drops no data and
-- changes no behaviour that anything currently depends on — the column is
-- empty everywhere it exists.
--
-- If a webhook is ever wanted, the right shape is the one the rest of this
-- codebase already uses: dispatch from application code AFTER the transaction
-- commits (see syncOrchestrator), where a failure is retryable and cannot take
-- the booking down with it.

DROP TRIGGER IF EXISTS trigger_notify_n8n_appointment ON public.appointments;
DROP FUNCTION IF EXISTS public.notify_n8n_on_appointment();
ALTER TABLE public.tenants DROP COLUMN IF EXISTS n8n_webhook_url;
