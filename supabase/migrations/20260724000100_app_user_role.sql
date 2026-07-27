-- 20260724000100_app_user_role.sql
--
-- STEP 2 OF 3. Creates the role the application should connect as.
--
-- DO NOT APPLY THIS WITHOUT 20260724000000_rls_null_safe_context.sql. That file
-- makes the policies null-safe; this one makes the policies actually run. In
-- the wrong order the result is every reminder silently stopping and every
-- reused pooled connection throwing invalid-uuid errors. The guard below
-- refuses to proceed if step 1 has not landed.
--
-- Applying this migration changes NOTHING on its own: creating a role does not
-- move any traffic. The switch happens when DATABASE_URL is repointed, which is
-- a deploy-time decision, not a migration.

-- ── Guard: step 1 must have landed ─────────────────────────────────────────
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = 'tenant_ctx_uuid' AND n.nspname = 'public'
  ) THEN
    RAISE EXCEPTION
      'refusing to create app_user: 20260724000000_rls_null_safe_context.sql has not been applied. '
      'Creating a non-bypassing role before the policies are null-safe stops every reminder silently.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%current_setting(%'
  ) THEN
    RAISE EXCEPTION
      'refusing to create app_user: some policies still read current_setting() directly';
  END IF;
END
$guard$;

-- ── The role ────────────────────────────────────────────────────────────────
--
-- NOSUPERUSER + NOBYPASSRLS is the entire point of this file. Everything else
-- is grants.
--
-- The password here is a placeholder for local and CI. Production sets a real
-- one out of band (ALTER ROLE app_user PASSWORD ...) — a secret does not belong
-- in a migration that lives in git.
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  ELSE
    -- Idempotent, and it re-asserts the two flags that matter in case someone
    -- granted them by hand.
    ALTER ROLE app_user NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$role$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;

-- Tables created by LATER migrations must be reachable too, or the first
-- migration after this one silently produces a table the app cannot read.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_user;

-- ── Prove the role is actually constrained ─────────────────────────────────
DO $verify$
DECLARE
  bypasses BOOLEAN;
BEGIN
  SELECT (rolsuper OR rolbypassrls) INTO bypasses FROM pg_roles WHERE rolname = 'app_user';
  IF bypasses THEN
    RAISE EXCEPTION 'app_user can bypass RLS — the role is pointless in this state';
  END IF;
END
$verify$;

-- ── STEP 3, which is NOT a migration ───────────────────────────────────────
--
--   DATABASE_URL=postgres://app_user:<password>@<host>/<db>
--
-- That is the moment RLS becomes load-bearing. Before flipping it in
-- production:
--
--   1. Run the suite locally against app_user. tests/regression/rlsIsolation.test.ts
--      covers the two landmines and cross-tenant isolation.
--   2. Confirm the reminder sweep still returns rows — that is the query with
--      the most to lose and no user watching it.
--   3. Keep the old URL to hand. Reverting is a single env var.
--
-- After the switch, GET /ready reports rls_enforced: true and the backend stops
-- logging rls_not_enforced at boot.
