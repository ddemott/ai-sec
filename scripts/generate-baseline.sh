#!/usr/bin/env bash
#
# generate-baseline.sh — regenerate supabase/baseline.sql from the migration chain.
#
# WHY: rebuild-db.sh prefers the single-file baseline.sql (fast: ~3s vs ~30s for
#      the full chain) and, in baseline mode, marks EVERY migration applied
#      without running it. So baseline.sql MUST represent the schema AFTER all
#      migrations. If it drifts (a migration adds a table but baseline isn't
#      regenerated), that table is silently absent from every baseline-built DB
#      — local Playwright globalSetup, npm run db:rebuild — while CI dodges it by
#      building from the chain. (Found 2026-06-19: knowledge_suggestion /
#      customer_messages / ai_cost_events were missing.)
#
# WHEN: run this whenever a migration adds/alters schema, then commit the result.
#
# HOW:  spins a throwaway DB, applies the full chain via setup-db.sh, and dumps
#       schema-only (--no-owner --no-privileges, matching the original flags).
#
# Usage: bash scripts/generate-baseline.sh
#        DATABASE_URL=postgres://... bash scripts/generate-baseline.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADMIN_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5433/postgres}"
OUT="$ROOT_DIR/supabase/baseline.sql"
TMP_DB="baseline_gen_tmp"
# Swap the database name in the connection string for the temp DB, preserving any
# ?query params (e.g. ?sslmode=require on managed Postgres) so the temp URL stays
# connectable.
QUERY=""
ADMIN_NOQ="$ADMIN_URL"
case "$ADMIN_URL" in
  *\?*)
    QUERY="?${ADMIN_URL#*\?}"
    ADMIN_NOQ="${ADMIN_URL%%\?*}"
    ;;
esac
BASE_URL="${ADMIN_NOQ%/*}"
TMP_URL="$BASE_URL/$TMP_DB$QUERY"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "Error: pg_dump is not installed. Install the PostgreSQL client first." >&2
  exit 1
fi

echo "[gen-baseline] (re)creating throwaway DB '$TMP_DB'..."
# CREATE/DROP DATABASE cannot run inside a transaction block; psql -c autocommits.
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $TMP_DB;"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $TMP_DB;"

cleanup() {
  psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $TMP_DB;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[gen-baseline] applying full migration chain to '$TMP_DB'..."
bash "$ROOT_DIR/scripts/setup-db.sh" "$TMP_URL" >/dev/null

echo "[gen-baseline] dumping schema-only → supabase/baseline.sql ..."
pg_dump "$TMP_URL" --schema-only --no-owner --no-privileges >"$OUT"

TABLES=$(grep -c '^CREATE TABLE ' "$OUT" || true)
echo "[gen-baseline] done. baseline.sql now has $TABLES CREATE TABLE statements."
echo "[gen-baseline] Review the diff, then commit supabase/baseline.sql."
