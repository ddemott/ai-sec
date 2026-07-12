-- Reminder lead time becomes DATA instead of a string you parse.
--
-- Before: reminder_type was a closed CHECK set ('confirmation','72h','24h','2h')
-- and the lead was re-derived at send time by parsing the type back into hours
-- (services/reminders/index.ts: `type === '72h' ? 72 : ...`). An arbitrary lead
-- — "text me 30 minutes before" — could not be expressed at all: not as a type
-- (CHECK rejects it) and not as a duration (no column holds one).
--
-- After: lead_minutes is the source of truth, and 'custom' is a legal type for
-- the caller-chosen reminder the voice agent now offers at booking. scheduled_for
-- is still what the worker sweeps on (start_time - lead); lead_minutes is what
-- lets the SMS say "in 30 minutes" instead of "in 0.5h", and what lets a
-- reschedule rebuild the row at the lead the caller actually asked for.

BEGIN;

ALTER TABLE reminder_schedules
    ADD COLUMN IF NOT EXISTS lead_minutes INTEGER;

-- Backfill from the type string — the very derivation this column removes.
UPDATE reminder_schedules
   SET lead_minutes = CASE reminder_type
                        WHEN 'confirmation' THEN 0
                        WHEN '72h' THEN 4320
                        WHEN '24h' THEN 1440
                        WHEN '2h'  THEN 120
                      END
 WHERE lead_minutes IS NULL;

-- Widen the closed set. 'custom' means "the lead is in lead_minutes, don't
-- infer it from my name" — which is true of every row now, but the legacy four
-- keep their names so existing rows, dashboards, and the partial unique index
-- (one 'scheduled' row per appointment+type) keep working unchanged.
ALTER TABLE reminder_schedules
    DROP CONSTRAINT IF EXISTS reminder_schedules_reminder_type_check;

ALTER TABLE reminder_schedules
    ADD CONSTRAINT reminder_schedules_reminder_type_check
    CHECK (reminder_type IN ('confirmation', '72h', '24h', '2h', 'custom'));

-- A reminder with no lead is meaningless; every row has one after the backfill.
-- NOT NULL is what stops a future writer from silently reintroducing the
-- parse-the-name-string habit.
ALTER TABLE reminder_schedules
    ALTER COLUMN lead_minutes SET NOT NULL;

-- Guard the range: negative = "remind them after the appointment" (nonsense),
-- and a lead longer than ~90 days is a typo or a units mix-up (30 days entered
-- as minutes), not a customer preference.
ALTER TABLE reminder_schedules
    ADD CONSTRAINT reminder_schedules_lead_minutes_sane
    CHECK (lead_minutes >= 0 AND lead_minutes <= 129600);

COMMENT ON COLUMN reminder_schedules.lead_minutes IS
    'How far before the appointment this reminder fires, in minutes. Source of truth for the lead (0 = confirmation, sent at booking). scheduled_for = appointment start_time - lead_minutes. Added 2026-07-12 so a caller can ask for any lead ("30 minutes before") instead of the four hardcoded types.';

COMMIT;
