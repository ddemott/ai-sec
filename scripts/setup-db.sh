#!/usr/bin/env bash
set -euo pipefail

# setup-db.sh: Apply pending schema migrations to a Postgres database.
#
# Usage:
#   ./scripts/setup-db.sh                         # uses DATABASE_URL env or local Docker default
#   ./scripts/setup-db.sh postgres://...          # explicit connection string
#   ./scripts/setup-db.sh --continue-on-error     # don't exit on first failed migration
#   ./scripts/setup-db.sh --baseline              # mark all current files as applied without running them
#                                                 # (use once when adopting schema_migrations on an existing DB)
#
# Tracks applied migrations in a schema_migrations table, so re-runs only
# apply new files. Works for local Docker and cloud (Supabase, Railway).
# Does NOT seed data — use seed-db.sh for that.

CONTINUE_ON_ERROR=0
BASELINE=0
DB_URL=""

for arg in "$@"; do
  case "$arg" in
    --continue-on-error) CONTINUE_ON_ERROR=1 ;;
    --baseline) BASELINE=1 ;;
    -h|--help)
      sed -n '3,16p' "$0"
      exit 0
      ;;
    *) DB_URL="$arg" ;;
  esac
done

DB_URL="${DB_URL:-${DATABASE_URL:-postgres://postgres:postgres@localhost:5433/postgres}}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql is not installed. Install the PostgreSQL client first." >&2
  exit 1
fi

if ! psql "$DB_URL" -c "SELECT 1" >/dev/null 2>&1; then
  echo "Error: cannot connect to database. Check your connection string." >&2
  exit 1
fi

# Bootstrap the tracking table. Idempotent.
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "SET client_min_messages=warning" <<'SQL' >/dev/null
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

# Redact both credentials and host — show only scheme + "@***" marker.
REDACTED=$(echo "$DB_URL" | sed -E 's#(://)[^@]*@.*#\1***@***#')
echo "[setup-db] Target: $REDACTED"
echo "[setup-db] Migrations dir: $MIGRATIONS_DIR"

APPLIED=0
SKIPPED=0
FAILED=0
FAILED_FILES=()

# Sort by filename so versions apply in order.
shopt -s nullglob
FILES=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob

if [ ${#FILES[@]} -eq 0 ]; then
  echo "[setup-db] No migration files found."
  exit 0
fi

# --baseline: record every file as applied without running it. Use once to
# adopt schema_migrations on a DB whose state already matches the files.
if [ $BASELINE -eq 1 ]; then
  echo "[setup-db] Baseline mode: marking ${#FILES[@]} files applied without running them."
  # Build one SQL batch to avoid N round trips (slow against pooled Postgres).
  {
    echo "BEGIN;"
    for f in "${FILES[@]}"; do
      fname=$(basename "$f")
      version="${fname%%_*}"
      echo "INSERT INTO schema_migrations (version, filename) VALUES ('$version', '$fname') ON CONFLICT (version) DO NOTHING;"
    done
    echo "COMMIT;"
  } | psql "$DB_URL" -v ON_ERROR_STOP=1 -q >/dev/null
  COUNT=$(psql "$DB_URL" -tA -c "SELECT COUNT(*) FROM schema_migrations")
  echo "[setup-db] schema_migrations now has $COUNT rows."
  exit 0
fi

# Fetch all applied versions in one round trip; check locally per file.
APPLIED_VERSIONS=$(psql "$DB_URL" -tA -c "SELECT version FROM schema_migrations" | tr '\n' '|')

for f in "${FILES[@]}"; do
  fname=$(basename "$f")
  # Version is the leading digit sequence before the first underscore.
  version="${fname%%_*}"

  if [[ "|$APPLIED_VERSIONS" == *"|$version|"* ]]; then
    SKIPPED=$((SKIPPED + 1))
    echo "SKIP    $fname"
    continue
  fi

  # Apply in a single transaction with the INSERT into schema_migrations.
  # If either the migration SQL or the tracking INSERT fails, the whole
  # transaction rolls back and we report failure.
  OUTPUT=$(psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction <<SQL 2>&1
\i $f
INSERT INTO schema_migrations (version, filename) VALUES ('$version', '$fname');
SQL
)
  RC=$?

  if [ $RC -eq 0 ]; then
    APPLIED=$((APPLIED + 1))
    echo "APPLY   $fname"
  else
    FAILED=$((FAILED + 1))
    FAILED_FILES+=("$fname")
    echo "FAIL    $fname"
    # Show the actual error, not just "may already be applied".
    echo "$OUTPUT" | grep -E "ERROR|DETAIL|HINT" | head -5 | sed 's/^/        /'
    if [ $CONTINUE_ON_ERROR -eq 0 ]; then
      echo ""
      echo "[setup-db] Stopping on first failure (pass --continue-on-error to apply remaining)."
      break
    fi
  fi
done

echo ""
echo "[setup-db] Summary: APPLIED=$APPLIED  SKIPPED=$SKIPPED  FAILED=$FAILED"

if [ $FAILED -gt 0 ]; then
  echo ""
  echo "Failed migrations:"
  for f in "${FAILED_FILES[@]}"; do
    echo "  - $f"
  done
  exit 1
fi
