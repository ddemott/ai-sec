#!/usr/bin/env bash
set -euo pipefail

# Kill any process using port 3000 (backend)
PORT=3000
PID=$(lsof -ti :$PORT || true)
if [ ! -z "$PID" ]; then
  echo "Killing process on port $PORT (PID: $PID)"
  kill -9 $PID
else
  echo "No process found on port $PORT"
fi

# Kill any process using port 3001 (dashboard)
PORT_DASH=3001
PID_DASH=$(lsof -ti :$PORT_DASH || true)
if [ ! -z "$PID_DASH" ]; then
  echo "Killing process on port $PORT_DASH (PID: $PID_DASH)"
  kill -9 $PID_DASH
else
  echo "No process found on port $PORT_DASH"
fi

# Delete lock files (ignore errors if not present)
rm -f .next/dev/lock dashboard/.next/dev/lock || true

# Start script for the complete AI Secretary SaaS stack
# Usage: ./scripts/start-all.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$ROOT_DIR"

echo "[ai-sec] 🚀 Starting full stack..."

# 1. Ensure Docker DB is running
if command -v docker-compose >/dev/null 2>&1 || docker compose version >/dev/null 2>&1; then
  echo "[ai-sec] 🐘 Ensuring Local Postgres is running..."
  docker compose up -d

  # Find the actual container name for Postgres
  POSTGRES_CONTAINER=$(docker ps -a --format '{{.Names}}' | grep ai-sec-db | head -n 1)
  if [ -z "$POSTGRES_CONTAINER" ]; then
    echo "[ai-sec] ❌ Could not find Postgres container."
    exit 1
  fi

  echo "[ai-sec] ⏳ Waiting for Postgres to be healthy..."
  until [ "$(docker inspect -f '{{.State.Health.Status}}' $POSTGRES_CONTAINER)" == "healthy" ]; do
    sleep 1
  done
  echo "[ai-sec] ✅ Postgres is ready."
else
  echo "[ai-sec] ⚠️ Warning: Docker Compose not found. Assuming DB is running elsewhere."
fi

# 2. Start services concurrently
setsid node dist/src/index.js > backend.log 2>&1 &
echo "Backend server started on port 3000 (dist/src/index.js)"
(cd dashboard && setsid npm run dev > ../dashboard.log 2>&1 &)
echo "Dashboard server started on port 3001 (dashboard/server.js)"

# Show status
sleep 5
echo "--- Server Status ---"
lsof -i :3000
lsof -i :3001
