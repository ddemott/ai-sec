#!/usr/bin/env bash
set -euo pipefail

# Bootstrap script for SecretaryHQ SaaS
# Ensures repeatable setup on any server with Docker and Node.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$ROOT_DIR"

echo "[secretaryhq] 📦 Installing backend dependencies..."
npm install

echo "[secretaryhq] 📦 Installing dashboard dependencies..."
cd dashboard && npm install && cd ..

# 1. Install Deno if missing
if ! command -v deno >/dev/null 2>&1; then
  if [ -f "$HOME/.deno/bin/deno" ]; then
    echo "[secretaryhq] ✅ Deno found at $HOME/.deno/bin/deno"
    export PATH="$HOME/.deno/bin:$PATH"
  else
    echo "[secretaryhq] 🦕 Installing Deno..."
    curl -fsSL https://deno.land/install.sh | sh > /dev/null
    export PATH="$HOME/.deno/bin:$PATH"
  fi
else
  echo "[secretaryhq] ✅ Deno is already in PATH."
fi

# 2. Start Database via Docker Compose
if command -v docker-compose >/dev/null 2>&1 || docker compose version >/dev/null 2>&1; then
  echo "[secretaryhq] 🐘 Starting Local Postgres (pgvector) via Docker Compose..."
  docker compose up -d
  
  echo "[secretaryhq] ⏳ Waiting for Postgres to be healthy..."
  until [ "$(docker inspect -f '{{.State.Health.Status}}' ai-sec-db)" == "healthy" ]; do
    sleep 1
  done
  echo "[secretaryhq] ✅ Postgres is ready."
  sleep 2
else
  echo "[secretaryhq] ⚠️ Docker Compose not found. Please start the DB manually."
fi

# 3. Apply Migrations and Seed
echo "[secretaryhq] 🚀 Setting up database schema and seed data..."
DB_URLS=("postgres://postgres:postgres@localhost:5433/postgres" "postgres://postgres:postgres@localhost:5433/test_db")

for url in "${DB_URLS[@]}"; do
  bash scripts/setup-db.sh "$url"
done


# 4. Final Verification
echo "[secretaryhq] 🧪 Running Backend TDD Test Suite (Vitest)..."
npm test

echo "[secretaryhq] 🧪 Running Edge Logic TDD Test Suite (Deno)..."
DATABASE_URL="postgres://postgres:postgres@localhost:5433/test_db?sslmode=disable" /home/dale/.deno/bin/deno test --allow-net --allow-env --allow-sys supabase/functions/vapi-tools/service_test.ts supabase/functions/vapi-tools/integration_test.ts

echo "[secretaryhq] 🧪 Running Dashboard TDD Test Suite (Vitest)..."
cd dashboard && npm test && cd ..

echo "[secretaryhq] 🎉 Setup Complete!"
echo "[secretaryhq] You are ready to develop."
