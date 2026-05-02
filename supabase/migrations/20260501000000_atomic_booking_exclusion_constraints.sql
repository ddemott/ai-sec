-- Make atomic-booking actually atomic under concurrent callers.
--
-- Background. The booking RPCs (book_appointment_atomic and
-- book_with_scheduling_atomic) check for overlapping appointments via
-- NOT EXISTS, then INSERT. Under READ COMMITTED with multiple
-- concurrent transactions, two callers can both pass the NOT EXISTS
-- check before either commits its INSERT — and end up double-booking
-- the same resource or employee.
--
-- The "atomic" in the function name only meant "one transaction." It
-- did not mean "serializable against concurrent writers."
--
-- Fix: declarative exclusion constraints on appointments. The DB
-- enforces non-overlap; the RPCs catch the violation and return
-- TIMESLOT_OCCUPIED honestly.
--
--   - appointments_no_resource_overlap: same resource, overlapping range
--   - appointments_no_employee_overlap: same employee, overlapping range
--
-- Both constraints scope to status='scheduled' and is_deleted=false so
-- canceled/completed/soft-deleted rows don't block new bookings.
--
-- The half-open range tstzrange(start_time, end_time, '[)') matches the
-- existing overlap check in the RPCs (start_time < other.end_time AND
-- end_time > other.start_time). Adjacent appointments (10:00-10:30
-- followed by 10:30-11:00) do not overlap.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointments
    ADD CONSTRAINT appointments_no_resource_overlap
    EXCLUDE USING gist (
        resource_id WITH =,
        tstzrange(start_time, end_time, '[)') WITH &&
    )
    WHERE (status = 'scheduled' AND (is_deleted IS NULL OR is_deleted = false));

ALTER TABLE appointments
    ADD CONSTRAINT appointments_no_employee_overlap
    EXCLUDE USING gist (
        employee_id WITH =,
        tstzrange(start_time, end_time, '[)') WITH &&
    )
    WHERE (
        employee_id IS NOT NULL
        AND status = 'scheduled'
        AND (is_deleted IS NULL OR is_deleted = false)
    );
