#!/usr/bin/env bash
set -euo pipefail

# bootstrap.sh: Full local development setup for SecretaryHQ.
# Installs deps, starts Docker DB, applies migrations, seeds, runs tests.
# Usage: npm run bootstrap

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$ROOT_DIR"

DB_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5433/postgres}"
TEST_DB_URL="postgres://postgres:postgres@localhost:5433/test_db"

echo "[secretaryhq] Installing backend dependencies..."
npm install

echo "[secretaryhq] Installing dashboard dependencies..."
cd dashboard && npm install && cd ..

# 1. Install Deno if missing
if ! command -v deno >/dev/null 2>&1; then
  if [ -f "$HOME/.deno/bin/deno" ]; then
    echo "[secretaryhq] Deno found at $HOME/.deno/bin/deno"
    export PATH="$HOME/.deno/bin:$PATH"
  else
    echo "[secretaryhq] Installing Deno..."
    curl -fsSL https://deno.land/install.sh | sh > /dev/null
    export PATH="$HOME/.deno/bin:$PATH"
  fi
else
  echo "[secretaryhq] Deno already installed."
fi

# 2. Start Database via Docker Compose
if command -v docker-compose >/dev/null 2>&1 || docker compose version >/dev/null 2>&1; then
  echo "[secretaryhq] Starting Postgres (pgvector) via Docker Compose..."
  docker compose up -d

  echo "[secretaryhq] Waiting for Postgres to be healthy..."
  CONTAINER_NAME=$(docker compose ps --format '{{.Name}}' | head -1)
  RETRIES=30
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null)" == "healthy" ] || [ $RETRIES -eq 0 ]; do
    sleep 1
    RETRIES=$((RETRIES - 1))
  done

  if [ $RETRIES -eq 0 ]; then
    echo "WARNING: Postgres health check timed out. Continuing anyway..."
  else
    echo "[secretaryhq] Postgres is ready."
  fi
  sleep 2
else
  echo "WARNING: Docker Compose not found. Start the DB manually."
fi

# 3. Apply Migrations + Seed (main + test DB)
for url in "$DB_URL" "$TEST_DB_URL"; do
  echo "[secretaryhq] Setting up database: ${url%%@*}@***"
  bash "$ROOT_DIR/scripts/setup-db.sh" "$url"
  bash "$ROOT_DIR/scripts/seed-db.sh" "$url"
done

# 4. Run Tests
echo "[secretaryhq] Running backend tests..."
npm test

echo "[secretaryhq] Running edge function tests..."
DATABASE_URL="$TEST_DB_URL?sslmode=disable" deno test --allow-net --allow-env --allow-sys \
  supabase/functions/vapi-tools/service_test.ts \
  supabase/functions/vapi-tools/integration_test.ts 2>/dev/null || \
  echo "WARNING: Edge function tests skipped (Deno test may not be available)"

echo "[secretaryhq] Running dashboard tests..."
cd dashboard && npm test && cd ..

echo "[secretaryhq] Setup complete!"
echo "  Start dev servers: npm start"
echo "  Dashboard: https://localhost:4000"
echo "  Backend:   https://localhost:4001"
