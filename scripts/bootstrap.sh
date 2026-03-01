#!/usr/bin/env bash
set -euo pipefail

# Bootstrap script for AI Secretary SaaS
# Ensures repeatable setup on any server with Docker and Node.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$ROOT_DIR"

echo "[ai-sec] 📦 Installing backend dependencies..."
npm install

echo "[ai-sec] 📦 Installing dashboard dependencies..."
cd dashboard && npm install && cd ..

# 1. Install Deno if missing
if ! command -v deno >/dev/null 2>&1; then
  if [ -f "$HOME/.deno/bin/deno" ]; then
    echo "[ai-sec] ✅ Deno found at $HOME/.deno/bin/deno"
    export PATH="$HOME/.deno/bin:$PATH"
  else
    echo "[ai-sec] 🦕 Installing Deno..."
    curl -fsSL https://deno.land/install.sh | sh > /dev/null
    export PATH="$HOME/.deno/bin:$PATH"
  fi
else
  echo "[ai-sec] ✅ Deno is already in PATH."
fi

# 2. Start Database via Docker Compose
if command -v docker-compose >/dev/null 2>&1 || docker compose version >/dev/null 2>&1; then
  echo "[ai-sec] 🐘 Starting Local Postgres (pgvector) via Docker Compose..."
  docker compose up -d
  
  echo "[ai-sec] ⏳ Waiting for Postgres to be healthy..."
  until [ "$(docker inspect -f '{{.State.Health.Status}}' ai-sec-db)" == "healthy" ]; do
    sleep 1
  done
  echo "[ai-sec] ✅ Postgres is ready."
  sleep 2
else
  echo "[ai-sec] ⚠️ Docker Compose not found. Please start the DB manually."
fi

# 3. Apply Migrations
echo "[ai-sec] 🚀 Applying SQL migrations..."
DB_URLS=("postgres://postgres:postgres@localhost:5433/postgres" "postgres://postgres:postgres@localhost:5433/test_db")

if command -v psql >/dev/null 2>&1; then
  for url in "${DB_URLS[@]}"; do
    echo "[ai-sec]   Targeting $url..."
    for f in supabase/migrations/*.sql; do
      echo "[ai-sec]     Applying $f..."
      PGPASSWORD=postgres psql "$url" -f "$f" > /dev/null
    done
  done

  # Apply Seed Data only to the main DB
  echo "[ai-sec] 🌱 Seeding main database..."
  PGPASSWORD=postgres psql "postgres://postgres:postgres@localhost:5433/postgres" -f supabase/seed.sql > /dev/null
else
  echo "[ai-sec] ⚠️ psql not found. Cannot apply migrations automatically."
  echo "[ai-sec] Please ensure the schema in 'supabase/migrations/' is applied."
fi

# 4. Final Verification
echo "[ai-sec] 🧪 Running Backend TDD Test Suite (Vitest)..."
npm test

echo "[ai-sec] 🧪 Running Edge Logic TDD Test Suite (Deno)..."
/home/dale/.deno/bin/deno test --allow-net --allow-env --allow-sys supabase/functions/vapi-tools/service_test.ts supabase/functions/vapi-tools/integration_test.ts

echo "[ai-sec] 🧪 Running Dashboard TDD Test Suite (Vitest)..."
cd dashboard && npm test && cd ..

echo "[ai-sec] 🎉 Setup Complete!"
echo "[ai-sec] You are ready to develop."
