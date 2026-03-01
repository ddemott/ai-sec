#!/usr/bin/env bash
set -euo pipefail

# Start script for the complete AI Secretary SaaS stack
# Usage: ./scripts/start-all.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$ROOT_DIR"

echo "[ai-sec] 🚀 Starting full stack..."

# 1. Ensure Docker DB is running
if command -v docker-compose >/dev/null 2>&1 || docker compose version >/dev/null 2>&1; then
  echo "[ai-sec] 🐘 Ensuring Local Postgres is running..."
  docker compose up -d
  
  echo "[ai-sec] ⏳ Waiting for Postgres to be healthy..."
  until [ "$(docker inspect -f '{{.State.Health.Status}}' ai-sec-db)" == "healthy" ]; do
    sleep 1
  done
  echo "[ai-sec] ✅ Postgres is ready."
else
  echo "[ai-sec] ⚠️ Warning: Docker Compose not found. Assuming DB is running elsewhere."
fi

# 2. Start services concurrently
echo "[ai-sec] 🚦 Launching Backend and Dashboard..."
echo "[ai-sec]    Backend: http://localhost:3000"
echo "[ai-sec]    Dashboard: http://localhost:3001"

./node_modules/.bin/concurrently \
  -n "BACKEND,DASHBOARD" \
  -c "blue,green" \
  "npm run dev:backend" \
  "npm run dev:dashboard"
