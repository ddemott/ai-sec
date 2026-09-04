#!/bin/bash
set -e

echo "Starting secretary test DB via docker-compose (ankane/pgvector on port 5433)..."

if ! docker compose ps db | grep -q "Up"; then
  docker compose up -d db
  echo "DB service started. Waiting for ready (healthcheck pg_isready)..."
  until docker compose exec -T db pg_isready -U postgres -d postgres > /dev/null 2>&1; do
    sleep 1
  done
fi

echo "Testing connection..."
if echo "SELECT 1;" | PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d postgres -t -q > /dev/null 2>&1; then
  echo "Connection successful. Test DB ready on postgres://postgres:postgres@localhost:5433/postgres (or test_db for some tests)"
else
  echo "Connection failed. Check logs: docker compose logs db"
  exit 1
fi

echo "Use in tests with DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres (or test_db)"
echo "To stop: docker compose stop db"
echo "To reset volume: docker compose down -v"
