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
# { localhost, 127.0.0.1, db, postgres, ai-sec-db }. Pass --force only
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
    ""|localhost|127.0.0.1|db|postgres|ai-sec-db)
      : # safe — local-looking
      ;;
    *)
      echo "[rebuild-db] REFUSED: host '$HOST' doesn't look like a local dev DB."
      echo "[rebuild-db] Allowed hosts: localhost, 127.0.0.1, db, postgres, ai-sec-db."
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

# Apply migrations (delegates to setup-db.sh — single source of truth
# for the apply logic and schema_migrations bookkeeping). This will
# reapply every file in order; nothing should be SKIP'd because we
# just dropped schema_migrations along with the rest of public.
echo "[rebuild-db] Applying migrations..."
bash "$ROOT_DIR/scripts/setup-db.sh" "$DB_URL"

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
