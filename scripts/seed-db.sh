#!/usr/bin/env bash
set -euo pipefail

# seed-db.sh: Insert demo/test data into a SecretaryHQ database.
# Usage: ./scripts/seed-db.sh [DATABASE_URL]
#
# Prerequisite: run setup-db.sh first to create tables.
# Safe to re-run — all inserts use ON CONFLICT DO NOTHING / DO UPDATE.

DB_URL="${1:-${DATABASE_URL:-postgres://postgres:postgres@localhost:5433/postgres}}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
SEED_FILE="$ROOT_DIR/supabase/seed.sql"

echo "[secretaryhq] Seeding database: ${DB_URL%%@*}@***"

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql is not installed."
  exit 1
fi

if ! psql "$DB_URL" -c "SELECT 1" >/dev/null 2>&1; then
  echo "Error: Cannot connect to database. Check your DATABASE_URL."
  exit 1
fi

if [ ! -f "$SEED_FILE" ]; then
  echo "Error: Seed file not found at $SEED_FILE"
  exit 1
fi

echo "  Applying supabase/seed.sql..."
# Capture psql output so a real failure (e.g. schema drift breaking the
# seed) surfaces with the actual error. Previously this redirected to
# /dev/null and treated every failure as "data already exists" — which
# silently hid the seed.sql being out-of-date relative to the schema
# from 2026-05-12 through 2026-05-13. ON_ERROR_STOP=1 + the captured
# output means a future regression is immediately visible in CI.
SEED_OUTPUT=$(psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$SEED_FILE" 2>&1) || {
  echo "[secretaryhq] ERROR: seed application failed:"
  echo "$SEED_OUTPUT" | sed 's/^/    /'
  exit 1
}
echo "[secretaryhq] Seed data applied successfully."

echo "[secretaryhq] Done. Platform admin + DynaTire demo tenant seeded."
echo "  Login: admin@secretaryhq.com / password (platform admin)"
echo "  Login: admin@dynatire.com / password (DynaTire tenant)"
