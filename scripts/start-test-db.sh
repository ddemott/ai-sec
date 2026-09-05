#!/bin/bash
set -e

echo "Starting secretary test DB via canonical docker-compose (ankane/pgvector on port 5433)..."

if ! docker compose ps db | grep -q "Up"; then
  docker compose up -d db
  echo "DB service started. Waiting for ready (healthcheck pg_isready)..."
  until docker compose exec -T db pg_isready -U postgres -d postgres > /dev/null 2>&1; do
    sleep 1
  done
fi

echo "Testing connection..."
if echo "SELECT 1;" | PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d postgres -t -q > /dev/null 2>&1; then
  echo "Connection successful."
else
  echo "Connection failed. Check logs: docker compose logs db"
  exit 1
fi

echo "Running full test DB bootstrap (fresh test_db + all migrations + app_user role)..."
DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres npx tsx scripts/setup-test-db.ts

echo "Test DB fully bootstrapped and ready."
echo "Use in tests with DATABASE_URL=postgres://postgres:postgres@localhost:5433/test_db"
echo "or REQUIRE_DB_TESTS=1 npm test"
echo "To stop: docker compose stop db"
echo "To reset volume: docker compose down -v"
