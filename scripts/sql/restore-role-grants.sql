-- restore-role-grants.sql
--
-- The FINAL intended privilege state for the two login roles, expressed
-- declaratively and idempotently. Run by scripts/rebuild-db.sh after a
-- baseline restore.
--
-- WHY THIS FILE EXISTS RATHER THAN A MIGRATION RE-RUN
-- supabase/baseline.sql is `pg_dump --schema-only --no-owner --no-privileges`,
-- and pg_dump never dumps roles, so a baseline-built database has every table
-- and no grants at all. Something has to put them back.
--
-- The obvious move — replay the migrations that granted them — is a trap:
--   * 20260228000003_api_user.sql grants ALL PRIVILEGES, which BUG-008 later
--     revoked. Replaying only that hands api_user TRUNCATE back, and
--     tests/regression/high-bugs.test.ts catches it (measured 2026-09-04).
--   * 20260316100000_fix_high_bugs.sql holds the correct grants, but replaying
--     it is DESTRUCTIVE: the same file recreates book_appointment_atomic in its
--     March 2026 form, against `employee_shifts` (dropped 2026-04-30) and the
--     pre-rename `tenants.id` / `customers.id` columns. It would silently
--     replace the live booking function with one written for a dead schema.
--
-- A migration is a delta that was correct on the day it ran. Restoring state
-- needs a statement of what the state should be NOW, which is this file.
-- app_user is different and is NOT duplicated here: its migration
-- (20260724000100) is a dedicated role migration containing nothing but the
-- role and its grants, so rebuild-db.sh re-applies it directly.
--
-- KEEP IN SYNC: if a migration ever changes api_user's privileges, change this
-- file in the same commit. tests/regression/high-bugs.test.ts (BUG-008) is the
-- guard that fails when the two disagree.

-- The role FLAGS are re-asserted, not just the grants. api_user exists to be
-- SUBJECT to RLS; a role that has picked up SUPERUSER or BYPASSRLS out of band
-- (a hand-run ALTER during debugging, a restore from an older cluster) silently
-- bypasses every policy while this file happily grants it the right four verbs
-- and reports success. Privileges without the flags are half a guarantee.
-- 20260724000100_app_user_role.sql re-asserts them on its existing-role branch
-- for the same reason; this matches it.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_user') THEN
        CREATE ROLE api_user WITH LOGIN PASSWORD 'api_password'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    ELSE
        ALTER ROLE api_user NOSUPERUSER NOBYPASSRLS;
    END IF;
END
$$;

-- Mirrors the BUG-008 block of 20260316100000_fix_high_bugs.sql: strip
-- everything, then re-grant only what the API needs. Notably NOT TRUNCATE.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM api_user;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM api_user;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM api_user;

GRANT USAGE ON SCHEMA public TO api_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO api_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO api_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO api_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO api_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO api_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO api_user;
