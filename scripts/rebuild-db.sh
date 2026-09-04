#!/usr/bin/env bash
set -euo pipefail

# rebuild-db.sh: Tear the database down to bare schema and rebuild
# end-to-end from migrations + seed. This is the canonical answer to
# "does the migration chain actually work against an empty DB?"
#
# WHO   : developer wanting a clean slate before exploring a feature,
#         OR cron/CI rehearsing the from-scratch path to catch migration
#         drift before it bites production
# WHAT  : DROP SCHEMA public CASCADE  →  apply every migration in
#         filename order  →  apply supabase/seed.sql  →  sanity check
# WHEN  : before a branch cut; after a migration-heavy PR; whenever the
#         local DB has gotten weird from manual SQL fiddling
# WHERE : runs against $DATABASE_URL (defaults to local Docker at port
#         5433). REFUSES by default to run against any host that doesn't
#         look local — pass --force to override (you will regret this).
# WHY   : migrations are *cumulative deltas*, not idempotent. The only
#         honest test that they actually rebuild the same schema is to
#         drop everything and run them in order against a real Postgres.
#         If a future migration depends on data that no longer exists,
#         or assumes a column that an earlier migration didn't create,
#         this script surfaces that failure deterministically. The
#         alternative — discovering it the first time prod gets a fresh
#         tenant — is much worse.
#
# Usage:
#   ./scripts/rebuild-db.sh                   # local default, asks to confirm
#   ./scripts/rebuild-db.sh --yes             # skip the confirmation prompt
#   ./scripts/rebuild-db.sh --no-seed         # rebuild schema only, skip seed
#   ./scripts/rebuild-db.sh postgres://...    # explicit URL
#   ./scripts/rebuild-db.sh --force --yes URL # bypass the safety check
#
# Safety: refuses to run against any host that doesn't match one of
# { localhost, 127.0.0.1, db, postgres, secretary-hq-db }. Pass --force only
# when you genuinely intend to wipe a remote dev DB. There is no way
# to override the prompt + safety check together except via --force
# --yes — by design, so two independent decisions are required.

NO_SEED=0
SKIP_CONFIRM=0
FORCE=0
DB_URL=""

for arg in "$@"; do
  case "$arg" in
    --no-seed) NO_SEED=1 ;;
    --yes|-y) SKIP_CONFIRM=1 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '3,38p' "$0"; exit 0 ;;
    *)        DB_URL="$arg" ;;
  esac
done

DB_URL="${DB_URL:-${DATABASE_URL:-postgres://postgres:postgres@localhost:5433/postgres}}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"

# Safety check: pull the host out of the URL and reject anything that
# doesn't look like a local dev DB. URLs without a host fall through
# to the safe branch (covers the unix-socket connection case).
HOST=$(echo "$DB_URL" | sed -En 's|.*@([^:/]+).*|\1|p')
if [ "$FORCE" -eq 0 ]; then
  case "$HOST" in
    ""|localhost|127.0.0.1|db|postgres|secretary-hq-db)
      : # safe — local-looking
      ;;
    *)
      echo "[rebuild-db] REFUSED: host '$HOST' doesn't look like a local dev DB."
      echo "[rebuild-db] Allowed hosts: localhost, 127.0.0.1, db, postgres, secretary-hq-db."
      echo "[rebuild-db] Pass --force to override (you will regret this)."
      exit 2
      ;;
  esac
fi

REDACTED=$(echo "$DB_URL" | sed -E 's#(://)[^@]*@.*#\1***@***#')
echo "[rebuild-db] Target: $REDACTED"
echo "[rebuild-db] This will DROP all tables, views, and functions in the 'public' schema."

if [ "$SKIP_CONFIRM" -eq 0 ]; then
  printf "[rebuild-db] Proceed? Type 'yes' to confirm: "
  read -r confirm
  if [ "$confirm" != "yes" ]; then
    echo "[rebuild-db] Aborted."
    exit 1
  fi
fi

# Drop and recreate the public schema. CASCADE drops every table,
# view, function, type, index, sequence, and extension owned by the
# schema in one statement. Then GRANT defaults back so the migrations
# can recreate objects without permission errors.
echo "[rebuild-db] Dropping public schema..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO PUBLIC;
SQL
echo "[rebuild-db] Schema cleared."

# Prefer the single-file baseline when present (UX audit session,
# 2026-05-18: schema squash). One ~5k-line file is faster to apply
# (~3s vs ~30s for 122 cumulative migrations), and far easier to
# debug — a syntax error has one obvious location instead of
# "patch 47 of 122". Fall back to the migration chain if baseline
# is missing (covers PRs that touch migrations/ but not baseline).
BASELINE="$ROOT_DIR/supabase/baseline.sql"
if [ -f "$BASELINE" ]; then
  echo "[rebuild-db] Applying baseline.sql (single-file schema)..."
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$BASELINE" > /dev/null
  echo "[rebuild-db] Baseline applied."

  # Populate schema_migrations with every historical migration filename
  # so the system knows those are already covered by the baseline.
  # Without this step, the next `setup-db.sh` invocation would try to
  # re-run all 122 historical migrations on top of the baseline schema
  # and fail on "table already exists." `--baseline` makes setup-db
  # mark them applied without re-running.
  echo "[rebuild-db] Marking historical migrations as applied (baseline mode)..."
  bash "$ROOT_DIR/scripts/setup-db.sh" --baseline "$DB_URL" > /dev/null
  echo "[rebuild-db] schema_migrations populated."

  # RE-APPLY THE ROLE + GRANTS. baseline.sql is `pg_dump --schema-only
  # --no-owner --no-privileges`, and pg_dump NEVER dumps roles — so a
  # baseline-built database has every policy and no app_user, and no GRANTs for
  # it even if the role survived (roles are cluster-wide; the grants died with
  # DROP SCHEMA). Connecting as app_user then fails with
  #
  #     error: permission denied for table customers
  #
  # which reads like an RLS failure and is not one — the same trap as the
  # 2026-07-17 api_user incident in docs/LESSONS_LEARNED.md, where schema-scoped
  # GRANTs vanished in a rebuild while `SELECT rolname` still said the role was
  # fine. Measured here, not assumed: rlsIsolation.test.ts went red with exactly
  # that message after a baseline rebuild.
  #
  # The migration is idempotent (CREATE ROLE guarded by an existence check, the
  # rest is GRANT), so re-running it is the whole fix.
  #
  # BOTH login roles have to be restored, not just one. This step fixed app_user
  # only until 2026-09-04, and the omission cost a session: a rebuild left the
  # realdb rig (which connects as api_user — tests/utils.ts API_DB_URL) with ZERO
  # grants, and 332 tests across 49 files failed with the exact message the
  # comment above predicts, "permission denied for table tenants". Confirmed by
  # count: `role_table_grants` held 0 rows for api_user after the rebuild and 322
  # after re-applying its migration.
  #
  # Restoring api_user works even though its grants predate most of the schema:
  # the GRANTs are ON ALL TABLES IN SCHEMA public, evaluated when they run, and
  # baseline.sql has already created every table by this point. Both files are
  # idempotent (guarded CREATE ROLE, then REVOKE/GRANT).
  #
  # KNOWN LIMIT of baseline mode, separate from grants: baseline.sql carries no
  # DATA, and setup-db.sh --baseline only MARKS migrations applied. Columns that
  # data migrations populate — business_templates.system_prompt_template and
  # .example_services — therefore stay empty, and seed.sql deliberately does not
  # fill them ("real values come from the original insert migrations which run
  # before seed in CI"). tests/routes/auth.test.ts and
  # tests/routes/vocabulary.test.ts require that data, so a baseline-rebuilt DB
  # cannot pass the full suite. For a CI-equivalent local DB, run the chain:
  #   psql "$DB_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
  #   bash scripts/setup-db.sh "$DB_URL" && npm run db:seed
  # app_user's migration is a dedicated role migration (role + grants, nothing
  # else), so replaying it is safe. api_user's is NOT — see the header of
  # scripts/sql/restore-role-grants.sql for why replaying either of its two
  # migrations is wrong, one subtly and one destructively.
  for ROLE_SQL in \
    "$ROOT_DIR/supabase/migrations/20260724000100_app_user_role.sql" \
    "$ROOT_DIR/scripts/sql/restore-role-grants.sql"; do
    if [ -f "$ROLE_SQL" ]; then
      echo "[rebuild-db] Re-applying $(basename "$ROLE_SQL") (pg_dump omits roles + privileges)..."
      psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$ROLE_SQL" > /dev/null
    fi
  done
  # Assert rather than announce: a silent zero here is the whole failure mode.
  for ROLE in app_user api_user; do
    GRANT_COUNT="$(psql "$DB_URL" -tAc \
      "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = '$ROLE';")"
    if [ "${GRANT_COUNT:-0}" -lt 1 ]; then
      echo "[rebuild-db] FATAL: $ROLE has no table grants after restore — the rebuilt DB"
      echo "            would fail as 'permission denied for table ...'. Aborting."
      exit 1
    fi
    # Grants alone are half a guarantee: a role that has picked up SUPERUSER or
    # BYPASSRLS out of band holds the right verbs AND bypasses every policy.
    ELEVATED="$(psql "$DB_URL" -tAc \
      "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = '$ROLE';")"
    if [ "$ELEVATED" = "t" ]; then
      echo "[rebuild-db] FATAL: $ROLE is SUPERUSER or has BYPASSRLS — RLS would not apply"
      echo "            to it and every policy in the database becomes decoration. Aborting."
      exit 1
    fi
    echo "[rebuild-db] $ROLE grants restored ($GRANT_COUNT), NOSUPERUSER + NOBYPASSRLS confirmed."
  done
else
  echo "[rebuild-db] baseline.sql not found — falling back to cumulative migrations..."
  bash "$ROOT_DIR/scripts/setup-db.sh" "$DB_URL"
fi

# Seed (delegates to seed-db.sh, which runs supabase/seed.sql).
if [ "$NO_SEED" -eq 0 ]; then
  echo ""
  echo "[rebuild-db] Seeding..."
  bash "$ROOT_DIR/scripts/seed-db.sh" "$DB_URL"
else
  echo "[rebuild-db] Seed skipped (--no-seed)."
fi

# Sanity check: count migrations applied + a representative table to
# prove the chain actually produced a working schema. If MIG > 0 and
# TENANTS > 0 (after seed) we know the round-trip works.
MIG=$(psql "$DB_URL" -tA -c "SELECT COUNT(*) FROM schema_migrations")
TENANTS=$(psql "$DB_URL" -tA -c "SELECT COUNT(*) FROM tenants" 2>/dev/null || echo "?")

echo ""
echo "[rebuild-db] Done."
echo "  migrations applied: $MIG"
echo "  tenants rows:       $TENANTS"
