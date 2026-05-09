-- Apply FORCE ROW LEVEL SECURITY to voice_sessions and record_versions.
--
-- Background. Migration 20260323 (force_rls_single_pool.sql) added FORCE to
-- every tenant-scoped table that existed at the time, because we connect
-- as `postgres` (which would otherwise BYPASSRLS). Two tables created
-- AFTER that migration enabled RLS + added a policy but never received
-- FORCE — meaning RLS doesn't apply to our connection and the policies
-- are decorative:
--
--   - voice_sessions   (created 2026-04-09 in 20260409000000)
--   - record_versions  (created 2026-04-09 in 20260409100000)
--
-- Both have a `tenant_id UUID` column and a tenant-isolation policy that
-- looks correct on paper, but production traffic via the `postgres` role
-- skips them. Any caller that joined or selected from these tables would
-- see cross-tenant rows. (We haven't observed this in the wild — call
-- summaries are written via the agent worker which always sets tenant
-- context before insert, and version history is read only via tenant-
-- scoped routes — but the floor is missing.)
--
-- Forward-only: ALTER ... FORCE is metadata-only, no row scan.

ALTER TABLE voice_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE record_versions FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE voice_sessions IS 'Per-call voice session state. RLS forced 2026-05-09 — closes gap from 20260409 (RLS+policy were enabled but FORCE was not).';
COMMENT ON TABLE record_versions IS 'Soft-delete + version history for tracked tables. RLS forced 2026-05-09 — same closure as voice_sessions.';
