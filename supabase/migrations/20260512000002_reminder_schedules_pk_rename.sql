-- Pilot #3 for the PK naming convention (per CLAUDE.md).
-- Renames reminder_schedules.id → reminder_schedule_id.
--
-- First SERIAL-PK pilot. The convention applies equally to SERIAL and
-- UUID PKs: row's own id is `<table_singular>_id`. The actual ALTER is
-- the same; what differs from the UUID pilots is the TS type stays
-- `number` (matches the underlying SERIAL/integer).
--
-- Why reminder_schedules:
--   - Zero inbound FKs (terminal in the schema).
--   - Zero RPCs / views reference the column.
--   - Limited production consumers: workers/reminderScheduler.ts +
--     services/reminders/index.ts + services/reminders/reminderRepository.ts
--     all call `db.updateReminderSchedule(reminder.id.toString(), …)`,
--     which goes through the database layer's SELECT / UPDATE by
--     primary key.
--   - Smallest remaining table in the conversion queue.

ALTER TABLE reminder_schedules RENAME COLUMN id TO reminder_schedule_id;

