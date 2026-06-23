-- ────────────────────────────────────────────────────────────────────
-- voice_sessions.requested_service_id — the service a caller was trying to
-- book on a call.
--
-- "Abandonment-by-service" analytics needs to know what service an abandoned
-- caller wanted, but abandoned calls have appointment_id = NULL (no booking to
-- join through). This column is set best-effort by the booking agent-tool
-- (book-with-scheduling) when the caller attempts to book a specific service —
-- so even a call that fails to complete (slot taken / no availability) records
-- which service the caller came for.
--
-- ON DELETE SET NULL: deleting a service must not cascade-delete call history.
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE voice_sessions
  ADD COLUMN IF NOT EXISTS requested_service_id UUID
  REFERENCES services(service_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_voice_sessions_requested_service_id
  ON voice_sessions (requested_service_id)
  WHERE requested_service_id IS NOT NULL;
