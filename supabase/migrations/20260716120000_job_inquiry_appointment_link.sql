-- A job inquiry that produced a MEETING should say which meeting.
--
-- Before this, job_inquiries carried only call_id: the owner saw a meeting on the
-- calendar and a job inquiry in another list, and had to correlate them by call. On a
-- "meeting about a job" call the inquiry IS the meeting's context — so it links to the
-- appointment directly, and the capture route also stamps a readable summary into
-- appointments.description so the calendar entry is self-contained.
--
-- Nullable, because a job inquiry without a meeting is legitimate (JOB-ONLY calls brief
-- the owner with no booking). ON DELETE SET NULL: destroying an appointment must not
-- destroy the lead — the inquiry row is the durable record, the link is just context.
ALTER TABLE job_inquiries
  ADD COLUMN appointment_id uuid REFERENCES appointments(appointment_id) ON DELETE SET NULL;

COMMENT ON COLUMN job_inquiries.appointment_id IS
  'The meeting this inquiry was booked around, when the call produced one. NULL for brief-the-owner-only inquiries. SET NULL on appointment delete: the lead outlives the meeting.';
