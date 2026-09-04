#!/bin/bash
set -e

echo "Starting secretary test DB on port 5433 (Postgres 15)..."

if docker ps --filter "name=secretary-test-db" --format "{{.Names}}" | grep -q secretary-test-db; then
  echo "Test DB already running."
else
  if docker ps -a --filter "name=secretary-test-db" --format "{{.Names}}" | grep -q secretary-test-db; then
    docker start secretary-test-db
    echo "Restarted existing container."
  else
    docker run -d \
      --name secretary-test-db \
      -e POSTGRES_PASSWORD=postgres \
      -e POSTGRES_DB=postgres \
      -p 5433:5432 \
      postgres:15
    echo "New container started."
  fi
  sleep 8  # Give Postgres time to init
fi

echo "Testing connection..."
if echo "SELECT 1;" | PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d postgres -t -q > /dev/null 2>&1; then
  echo "Connection successful. Test DB ready on postgres://postgres:postgres@localhost:5433/postgres"
else
  echo "Connection failed. Check docker logs: docker logs secretary-test-db"
  exit 1
fi

echo "Use in tests with DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres"
echo "To stop: docker stop secretary-test-db && docker rm secretary-test-db"
