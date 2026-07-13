-- Soft-delete for tenants — the one entity that didn't have it, and the one whose
-- deletion is most catastrophic.
--
-- THE ASYMMETRY THIS FIXES:
--   customers      → is_deleted, deleted_at, deleted_by  ✅
--   appointments   → is_deleted                          ✅
--   voice_sessions → is_deleted, deleted_at, deleted_by  ✅
--   services       → is_deleted                          ✅
--   tenants        → (nothing)                           ❌  ← most destructive, least protected
--
-- A hard DELETE FROM tenants obliterates a business: every appointment, customer,
-- call recording, transcript, consent record, opt-out record. Irreversible, one
-- call, no undo. And it was reachable two ways in production:
--   1. DELETE /tenants/:id (super-admin)
--   2. cleanupExpiredDemoTenants() — runs EVERY 60 SECONDS in the reminder worker
--
-- IT ALSO CAUSES DEADLOCKS. Booking routes seed reminders fire-and-forget
-- (`void scheduleRemindersForAppointment(...)`), so a reminder_schedules INSERT is
-- often still running after the HTTP response returned. That INSERT takes FK locks
-- tenants → appointments; the cascading DELETE takes them appointments → tenants.
-- Opposite order = AB-BA cycle, and Postgres kills one side at random. This failed
-- CI roughly one run in two and read exactly like flake (PR #242). The same race
-- exists in prod, where the 60-second demo reaper meets a live booking.
--
-- An UPDATE that flips a flag takes no cascade locks. The deadlock cannot form.
--
-- HARD DELETE IS NOT REMOVED — it becomes a deliberate, manual, maintenance-window
-- operation (and stays in test teardown, where the bare-bones-DB rule requires it).
-- What changes is that nothing in the running application performs one.
--
-- THE RISK THIS INTRODUCES, stated plainly: a soft delete is only as good as its
-- filter coverage. Miss a read path and a "deleted" business keeps answering its
-- phone, booking appointments, and billing. A hard delete is brutally honest — the
-- row is gone and everything fails loudly. So the filter is enforced at a CHOKE
-- POINT (createWithTenantClient, which every tenant-scoped route passes through)
-- rather than sprinkled across the ~35 sites that read this table.

-- NOTE: no explicit BEGIN/COMMIT. scripts/setup-db.sh applies migrations under
-- `psql --single-transaction`, so this file already runs inside one. A nested BEGIN
-- warns and no-ops, and a COMMIT here would close the RUNNER's transaction early.
-- (Flagged in review on PR #241.)

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS is_deleted  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by  UUID REFERENCES users(user_id) ON DELETE SET NULL;

-- Every live-tenant lookup filters on this, so index the live rows only. A partial
-- index stays small: deleted tenants are the rare case and are never looked up on
-- the hot path.
CREATE INDEX IF NOT EXISTS tenants_live_idx ON tenants (tenant_id) WHERE is_deleted = false;

-- Purge candidates: "everything soft-deleted more than N days ago". Only the purge
-- path scans this way.
CREATE INDEX IF NOT EXISTS tenants_deleted_at_idx ON tenants (deleted_at) WHERE is_deleted = true;

COMMENT ON COLUMN tenants.is_deleted IS
    'Soft delete. The application NEVER hard-deletes a tenant: DELETE /tenants/:id and the demo-expiry reaper both flip this flag instead. A hard DELETE (which cascades away every appointment, customer, call recording and consent record) is now a deliberate maintenance-window operation only. Also removes the AB-BA deadlock between the cascade and fire-and-forget reminder seeding. 2026-07-13.';

COMMENT ON COLUMN tenants.deleted_at IS
    'When the tenant was soft-deleted. The (unbuilt, opt-in) purge worker would use this as the retention clock.';
