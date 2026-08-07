# DEVELOPMENT_WORKFLOW.md

## Local Development Setup

1. Start services: `npm run start` or `docker compose up -d db` for DB only.
2. Bootstrap test database: `npx tsx scripts/setup-test-db.ts`
   - Creates `test_db` if missing.
   - Runs all `supabase/migrations/` up to and including `20260724000100_app_user_role.sql` **as superuser**.
   - Creates `app_user` role with `NOBYPASSRLS`.
   - Applies grants and verifies posture.
   - Guards against prod DBs (refuses non-local hosts or prod-named DBs).
3. Run migrations/seed if needed: `npm run db:rebuild` (full reset) or `npm run db:migrate && npm run db:seed`.
4. Run tests: `npm test` (uses `tests/utils.ts` patterns; `REQUIRE_DB_TESTS=1` for CI enforcement).
   - `tests/regression/rlsIsolation.test.ts` now passes (no more "Cannot reach the database as app_user" error).
   - Other tests use `ROOT_DB_URL`, `skipIfDbDown()`, `setupBasicTenant()`, transaction savepoints.

## RLS / Role Testing

- Always run `setup-test-db.ts` before the RLS suite or full test run.
- The test uses `appUser` pool derived from `TEST_APP_USER_DATABASE_URL` (defaults via `ROOT_DB_URL` to `app_user` on `test_db`).
- `rlsTest()` wrapper throws with clear message if `available=false`.
- Verification in bootstrap matches the `DO $verify$` block in the role migration.

## DB Scripts Overview (match project style)

- `scripts/setup-test-db.ts`: Targeted test bootstrap (this file; uses pg Client + schema_migrations tracking like `setup-db.sh`).
- `scripts/setup-db.sh`: General migration applicator.
- `scripts/rebuild-db.sh`: DROP + full rebuild + seed (re-applies role migration post-baseline).
- `tests/utils.ts`: Test helpers (`getRootClient()`, `clearDB()`, `skipIfDbDown()`, `setupBasicTenant()`, transaction isolation). Extended indirectly via consistent URL usage.

## Guarding Prod

All DB scripts check host (`localhost`, `127.0.0.1`, etc.) and DB name. `setup-test-db.ts` refuses prod-like URLs explicitly. Matches `rebuild-db.sh` safety pattern and `src/database/index.ts` local vs managed detection.

## CI / Pre-PR

`npm run pre-pr` includes tests. `test:ci` sets `DATABASE_URL` to test_db. Bootstrap ensures RLS tests run reliably.

Run `npx tsx scripts/setup-test-db.ts` after schema changes affecting RLS or roles.

**Verified:** Script completes without error. `npm run test -- tests/regression/rlsIsolation.test.ts` now succeeds (role posture assertions pass).

See `HANDOFF.md`, `CODING_STANDARDS.md`, `supabase/migrations/20260724000100_app_user_role.sql` for context.
