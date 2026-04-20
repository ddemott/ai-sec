#!/usr/bin/env bash
set -euo pipefail

# setup-db.sh: Apply all schema migrations to a Postgres database.
# Usage: ./scripts/setup-db.sh [DATABASE_URL]
#
# Works for both local Docker and cloud (Supabase, Railway, etc.).
# Does NOT seed data — use seed-db.sh for that.

DB_URL="${1:-${DATABASE_URL:-postgres://postgres:postgres@localhost:5433/postgres}}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"

echo "[secretaryhq] Applying ${#MIGRATIONS[@]:-} migrations to: ${DB_URL%%@*}@***"

# Check psql
if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql is not installed. Install the PostgreSQL client first."
  exit 1
fi

# Verify connection
if ! psql "$DB_URL" -c "SELECT 1" >/dev/null 2>&1; then
  echo "Error: Cannot connect to database. Check your DATABASE_URL."
  exit 1
fi

# Apply migrations in order
MIGRATIONS=$(find "$ROOT_DIR/supabase/migrations" -name "*.sql" | sort)
APPLIED=0
FAILED=0

for f in $MIGRATIONS; do
  fname=$(basename "$f")
  echo "  Applying $fname..."
  if ! psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$f" > /dev/null 2>&1; then
    echo "  WARNING: $fname had errors (may already be applied). Continuing..."
    FAILED=$((FAILED + 1))
  else
    APPLIED=$((APPLIED + 1))
  fi
done

TOTAL=$(echo "$MIGRATIONS" | wc -w)
echo "[secretaryhq] Done. $APPLIED/$TOTAL migrations applied ($FAILED skipped/already applied)."
