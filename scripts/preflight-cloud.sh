#!/usr/bin/env bash
set -euo pipefail

# preflight-cloud.sh: Validates cloud database prerequisites before running migrations.
# Usage: ./scripts/preflight-cloud.sh <DATABASE_URL>
#
# Run this BEFORE setup-db.sh to catch issues early.

DB_URL="${1:-}"

if [ -z "$DB_URL" ]; then
  echo "Usage: ./scripts/preflight-cloud.sh <DATABASE_URL>"
  echo "Example: ./scripts/preflight-cloud.sh 'postgres://postgres:PASSWORD@db.PROJECT_ID.supabase.co:5432/postgres'"
  exit 1
fi

PASS=0
FAIL=0
WARN=0

pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }
warn() { echo "  [WARN] $1"; WARN=$((WARN + 1)); }

echo "============================================"
echo " SecretaryHQ - Cloud Migration Pre-flight"
echo "============================================"
echo ""

# 1. Check psql is available
echo "1. Checking local tools..."
if command -v psql >/dev/null 2>&1; then
  pass "psql is installed ($(psql --version | head -1))"
else
  fail "psql is not installed. Install the PostgreSQL client first."
  echo ""
  echo "Results: $PASS passed, $FAIL failed, $WARN warnings"
  exit 1
fi

# 2. Test database connectivity
echo ""
echo "2. Testing database connectivity..."
if psql "$DB_URL" -c "SELECT 1;" > /dev/null 2>&1; then
  pass "Connected to database successfully"
else
  fail "Cannot connect to database. Check your connection string and network."
  echo "   Hint: Supabase direct connection uses port 5432. Pooler uses port 6543."
  echo "   Hint: Use the DIRECT connection string (not transaction-mode pooler) for migrations."
  echo ""
  echo "Results: $PASS passed, $FAIL failed, $WARN warnings"
  exit 1
fi

# 3. Check connection mode (direct vs pooler)
echo ""
echo "3. Checking connection mode..."
PORT=$(echo "$DB_URL" | grep -oP ':(\d+)/' | tr -d ':/')
if [ "$PORT" = "6543" ]; then
  fail "Connection appears to use the Supabase pooler (port 6543). Migrations require the DIRECT connection (port 5432)."
  echo "   Hint: Replace port 6543 with 5432 in your connection string."
elif [ "$PORT" = "5432" ]; then
  pass "Using direct connection (port 5432)"
else
  warn "Non-standard port ($PORT). Verify this is a direct connection, not a pooler."
fi

# 4. Check pgvector extension
echo ""
echo "4. Checking required extensions..."
PGVECTOR=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM pg_extension WHERE extname = 'vector';" 2>/dev/null | tr -d ' ')
if [ "$PGVECTOR" = "1" ]; then
  pass "pgvector extension is enabled"
else
  fail "pgvector extension is NOT enabled. Run: CREATE EXTENSION IF NOT EXISTS vector;"
fi

# 5. Check pg_net extension
PGNET=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_net';" 2>/dev/null | tr -d ' ')
if [ "$PGNET" = "1" ]; then
  pass "pg_net extension is enabled"
else
  warn "pg_net extension is NOT enabled. The n8n appointment trigger will use RAISE NOTICE fallback."
  echo "   To enable: CREATE EXTENSION IF NOT EXISTS pg_net;"
fi

# 6. Check if api_user role can be created
echo ""
echo "5. Checking role creation capability..."
CAN_CREATE_ROLE=$(psql "$DB_URL" -t -c "SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user;" 2>/dev/null | tr -d ' ')
if [ "$CAN_CREATE_ROLE" = "t" ]; then
  pass "Current user can create roles (api_user creation will work)"
else
  # Check if api_user already exists
  API_USER_EXISTS=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM pg_roles WHERE rolname = 'api_user';" 2>/dev/null | tr -d ' ')
  if [ "$API_USER_EXISTS" = "1" ]; then
    pass "api_user role already exists"
  else
    warn "Current user cannot create roles and api_user does not exist."
    echo "   Option 1: Create api_user manually via the Supabase SQL Editor using grants from migration 20260228000003_api_user.sql"
    echo "   Option 2: Use the service_role connection for the backend instead of a separate api_user pool"
  fi
fi

# 7. Check if database is empty (fresh) or has existing tables
echo ""
echo "6. Checking database state..."
TABLE_COUNT=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public';" 2>/dev/null | tr -d ' ')
if [ "$TABLE_COUNT" = "0" ]; then
  pass "Database is empty (clean slate for migrations)"
else
  warn "Database has $TABLE_COUNT existing public tables. Re-running migrations may fail on non-idempotent statements."
  echo "   If this is intentional (e.g., partial migration), proceed with caution."

  # Check for specific tables to gauge how far migrations got
  HAS_TENANTS=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM pg_tables WHERE tablename = 'tenants' AND schemaname = 'public';" 2>/dev/null | tr -d ' ')
  HAS_TENANT_DOCS=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM pg_tables WHERE tablename = 'tenant_docs' AND schemaname = 'public';" 2>/dev/null | tr -d ' ')
  HAS_AUDIT_LOG=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM pg_tables WHERE tablename = 'audit_log' AND schemaname = 'public';" 2>/dev/null | tr -d ' ')

  echo "   Existing tables: tenants=$HAS_TENANTS, tenant_docs=$HAS_TENANT_DOCS, audit_log=$HAS_AUDIT_LOG"
fi

# 8. Check available disk/connection info
echo ""
echo "7. Checking database server info..."
PG_VERSION=$(psql "$DB_URL" -t -c "SHOW server_version;" 2>/dev/null | tr -d ' ')
MAX_CONN=$(psql "$DB_URL" -t -c "SHOW max_connections;" 2>/dev/null | tr -d ' ')
echo "   PostgreSQL version: $PG_VERSION"
echo "   Max connections: $MAX_CONN"

if [[ "$PG_VERSION" == 15* ]] || [[ "$PG_VERSION" == 16* ]] || [[ "$PG_VERSION" == 17* ]]; then
  pass "PostgreSQL version $PG_VERSION is supported"
else
  warn "PostgreSQL version $PG_VERSION — this project was developed on 15+. Older versions may have issues."
fi

# 9. Check RLS capability
echo ""
echo "8. Checking RLS support..."
RLS_TABLES=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true;" 2>/dev/null | tr -d ' ')
if [ "$TABLE_COUNT" = "0" ]; then
  pass "RLS will be configured by migrations (empty database)"
else
  echo "   Tables with RLS enabled: $RLS_TABLES"
  if [ "$RLS_TABLES" -gt "0" ]; then
    pass "RLS is active on $RLS_TABLES tables"
  else
    warn "No tables have RLS enabled yet"
  fi
fi

# 10. Migration file count check
echo ""
echo "9. Checking migration files..."
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
MIGRATION_COUNT=$(find "$ROOT_DIR/supabase/migrations" -name "*.sql" | wc -l)
if [ "$MIGRATION_COUNT" -ge 38 ]; then
  pass "$MIGRATION_COUNT migration files found"
else
  warn "Expected 38+ migration files, found $MIGRATION_COUNT"
fi

# Summary
echo ""
echo "============================================"
echo " Results: $PASS passed, $FAIL failed, $WARN warnings"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "FIX the FAIL items above before running setup-db.sh."
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo ""
  echo "Review the WARN items above. You may proceed, but address warnings for a clean deployment."
  echo ""
  echo "Ready to migrate? Run:"
  echo "  ./scripts/setup-db.sh '$DB_URL'"
  exit 0
else
  echo ""
  echo "All checks passed! Run:"
  echo "  ./scripts/setup-db.sh '$DB_URL'"
  exit 0
fi
