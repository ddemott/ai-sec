-- 20260701020000_reminder_schedules_unique_scheduled_bundle.sql
--
-- DB-level idempotency for the reminder seed (PR #156 review follow-up).
--
-- scheduleRemindersForAppointment() is fire-and-forget; a retry wrapper or a
-- double tool-call could seed a duplicate 4-row bundle and double-remind the
-- customer. An app-level probe is check-then-insert (race-prone under
-- concurrency), and serializing with an explicit transaction + advisory lock
-- deadlocked against the appointments cascade path in E2E (the same hazard
-- documented in the service's multi-row-INSERT comment). The durable fix is
-- a partial unique index: at most ONE 'scheduled' reminder per
-- (appointment_id, reminder_type). The seed INSERTs with
-- ON CONFLICT ... DO NOTHING — single statement, no cross-statement locks,
-- races resolve in the arbiter.
--
-- Reschedules keep working: rescheduleRemindersForAppointment cancels the old
-- bundle (status='cancelled' leaves the partial index) before reseeding.

-- Cancel any already-duplicated scheduled reminders (keep the newest row per
-- (appointment_id, reminder_type)) so the unique index can build. Cancelled,
-- not deleted — consistent with the reschedule path's audit-trail rule.
UPDATE reminder_schedules rs
   SET status = 'cancelled', updated_at = NOW()
 WHERE rs.status = 'scheduled'
   AND EXISTS (
     SELECT 1
       FROM reminder_schedules newer
      WHERE newer.appointment_id = rs.appointment_id
        AND newer.reminder_type = rs.reminder_type
        AND newer.status = 'scheduled'
        AND newer.reminder_schedule_id > rs.reminder_schedule_id
   );

CREATE UNIQUE INDEX IF NOT EXISTS reminder_schedules_one_scheduled_per_type
  ON reminder_schedules (appointment_id, reminder_type)
  WHERE status = 'scheduled';
