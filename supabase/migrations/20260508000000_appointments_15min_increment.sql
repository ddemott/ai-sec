-- Migration: enforce 15-minute booking-grid increments at the DB level
--
-- Background. All appointments must start AND end on a 15-minute clock
-- increment (1:00, 1:15, 1:30, 1:45 — never 1:07 or 1:23). The dashboard
-- form snaps to a dropdown of valid options, and the appointmentValidation
-- helper rejects off-grid times in both /appointments/create and
-- /agent-tools/book-appointment Zod paths. This DB CHECK is the third
-- layer — guards against a curl/Postman call that bypasses the Node
-- validation, against a future bug in the validator, and against any
-- service role that writes to appointments outside the routes (e.g. CRM
-- pull-sync inserting a row with foreign-system non-15-min times).
--
-- Timezone independence. Any real-world timezone offset (whole, half, or
-- quarter-hour) preserves the 15-min mod against UTC: a local :00/:15/
-- :30/:45 always maps to a UTC :00/:15/:30/:45. So the CHECK can extract
-- minutes from the timestamptz directly without an AT TIME ZONE clause.
-- Verified for IST (+05:30), Nepal (+05:45), Newfoundland (-03:30), and
-- every whole-hour zone in the Olson database.
--
-- Existing rows. The 3 appointments in prod (2026-04-30 audit) are all
-- on :00 / :30 boundaries — they pass the constraint cleanly. Any future
-- migration that relaxes this rule (e.g. 5-minute increments) needs to
-- DROP these constraints first.

ALTER TABLE appointments
    ADD CONSTRAINT appointments_start_time_15min
    CHECK (
        EXTRACT(MINUTE FROM start_time)::int IN (0, 15, 30, 45)
        AND EXTRACT(SECOND FROM start_time) = 0
    );

ALTER TABLE appointments
    ADD CONSTRAINT appointments_end_time_15min
    CHECK (
        EXTRACT(MINUTE FROM end_time)::int IN (0, 15, 30, 45)
        AND EXTRACT(SECOND FROM end_time) = 0
    );

COMMENT ON CONSTRAINT appointments_start_time_15min ON appointments IS
'All appointments must start on a 15-minute clock boundary (:00, :15, :30, :45). Enforced 2026-05-08.';

COMMENT ON CONSTRAINT appointments_end_time_15min ON appointments IS
'All appointments must end on a 15-minute clock boundary (:00, :15, :30, :45). Enforced 2026-05-08.';
