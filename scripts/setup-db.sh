#!/usr/bin/env bash
set -euo pipefail

# setup-db.sh: Automates schema migrations and seeding for SecretaryHQ SaaS.
# Usage: ./scripts/setup-db.sh [DATABASE_URL]
# If DATABASE_URL is not provided, it defaults to the local Docker Postgres.

DB_URL="${1:-postgres://postgres:postgres@localhost:5433/postgres}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$ROOT_DIR"

echo "[secretaryhq] 🚀 Starting database setup for: $DB_URL"

# 1. Check if psql is available
if ! command -v psql >/dev/null 2>&1; then
  echo "Error: 'psql' is not installed. Please install the PostgreSQL client."
  exit 1
fi

# 2. Apply Migrations in alphabetical order
echo "[secretaryhq] 📂 Applying migrations from supabase/migrations/..."
# Using find and sort to ensure strict alphabetical/chronological order
MIGRATIONS=$(find supabase/migrations -name "*.sql" | sort)

for f in $MIGRATIONS; do
  echo "[secretaryhq]   Applying $f..."
  # We use --single-transaction to ensure each migration file succeeds fully or fails fully
  if ! psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$f" > /dev/null; then
    echo "Error applying $f. Aborting."
    exit 1
  fi
done

# 3. Apply Seed Data
echo "[secretaryhq] 🌱 Seeding database from supabase/seed.sql..."
if ! psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f supabase/seed.sql > /dev/null; then
  echo "Error applying seed data. Aborting."
  exit 1
fi

echo "[secretaryhq] ✅ Database setup complete!"
