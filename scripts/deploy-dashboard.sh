#!/usr/bin/env bash
set -euo pipefail

# deploy-dashboard.sh: Builds and deploys the Next.js dashboard for AI Secretary.
# Detects Vercel CLI or prints manual instructions.
#
# Requires env vars: NEXT_PUBLIC_API_BASE_URL
#
# Can be run standalone or called from deploy-production.sh.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
DASHBOARD_DIR="$ROOT_DIR/dashboard"

log() { echo "[ai-sec] $1"; }
err() { echo "[ai-sec] ERROR: $1" >&2; }

# ---------------------------------------------------------------------------
# 1. Validate
# ---------------------------------------------------------------------------
if [ ! -d "$DASHBOARD_DIR" ]; then
  err "Dashboard directory not found at $DASHBOARD_DIR"
  exit 1
fi

if [ -z "${NEXT_PUBLIC_API_BASE_URL:-}" ]; then
  err "NEXT_PUBLIC_API_BASE_URL is not set."
  err "Set it to the public URL of your deployed backend (e.g., https://your-backend.railway.app)"
  exit 1
fi

for tool in node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    err "'$tool' is not installed."
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# 2. Install dependencies
# ---------------------------------------------------------------------------
log "Installing dashboard dependencies..."
cd "$DASHBOARD_DIR"
npm ci 2>/dev/null || npm install

# ---------------------------------------------------------------------------
# 3. Build
# ---------------------------------------------------------------------------
log "Building dashboard (NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL)..."

export NEXT_PUBLIC_API_BASE_URL

npm run build

if [ ! -d "$DASHBOARD_DIR/.next" ]; then
  err "Build failed: .next directory not found."
  exit 1
fi

log "Dashboard build successful."

# ---------------------------------------------------------------------------
# 4. Platform-specific deployment
# ---------------------------------------------------------------------------
if command -v vercel >/dev/null 2>&1; then
  # --- Vercel CLI detected ---
  log "Vercel CLI detected. Deploying to Vercel..."

  log "Setting environment variable..."
  vercel env add NEXT_PUBLIC_API_BASE_URL production <<< "$NEXT_PUBLIC_API_BASE_URL" 2>/dev/null || true

  log "Deploying to production..."
  vercel --prod

  VERCEL_URL=$(vercel inspect 2>/dev/null | grep -oP 'https://\S+' | head -1 || echo "(check Vercel dashboard)")
  log "Dashboard deployed to Vercel."
  log "URL: $VERCEL_URL"

else
  # --- No Vercel CLI ---
  log "Vercel CLI not detected."
  log ""
  log "The dashboard has been built successfully. To deploy:"
  log ""
  log "=== Option A: Vercel (recommended) ==="
  log "  1. Install CLI: npm install -g vercel"
  log "  2. Login: vercel login"
  log "  3. Re-run this script"
  log "  -- or deploy via Vercel web UI: --"
  log "  1. Go to https://vercel.com and import your GitHub repository"
  log "  2. Set Root Directory to 'dashboard'"
  log "  3. Set Framework Preset to 'Next.js'"
  log "  4. Add environment variable:"
  log "     NEXT_PUBLIC_API_BASE_URL = $NEXT_PUBLIC_API_BASE_URL"
  log "  5. Click Deploy"
  log ""
  log "=== Option B: Self-hosted ==="
  log "  cd dashboard"
  log "  NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL npm run build"
  log "  npm start"
  log ""
  log "=== Option C: Docker ==="
  log "  Build a Docker image using the Next.js standalone output mode."
  log "  See: https://nextjs.org/docs/deployment#docker-image"
fi

log "Dashboard deployment step complete."
