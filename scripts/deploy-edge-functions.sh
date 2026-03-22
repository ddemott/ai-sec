#!/usr/bin/env bash
set -euo pipefail

# deploy-edge-functions.sh: Deploys Supabase Edge Functions for AI Secretary.
# Requires env vars: SUPABASE_PROJECT_ID, SUPABASE_ACCESS_TOKEN, OPENAI_API_KEY,
#                    VAPI_SERVER_URL_SECRET, DATABASE_URL
#
# Can be run standalone or called from deploy-production.sh.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$ROOT_DIR"

log() { echo "[ai-sec] $1"; }
err() { echo "[ai-sec] ERROR: $1" >&2; }

# ---------------------------------------------------------------------------
# 1. Validate required env vars
# ---------------------------------------------------------------------------
REQUIRED_VARS=(SUPABASE_PROJECT_ID SUPABASE_ACCESS_TOKEN OPENAI_API_KEY VAPI_SERVER_URL_SECRET DATABASE_URL)
MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    MISSING+=("$var")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  err "Missing required environment variables:"
  for var in "${MISSING[@]}"; do
    err "  - $var"
  done
  err ""
  err "Set them in your shell or use deploy-production.sh with a .env.production file."
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Check Supabase CLI
# ---------------------------------------------------------------------------
log "Checking Supabase CLI..."

if command -v npx >/dev/null 2>&1; then
  SUPABASE_CMD="npx supabase"
  log "Using npx supabase (from devDependencies)"
elif command -v supabase >/dev/null 2>&1; then
  SUPABASE_CMD="supabase"
  log "Using global supabase CLI"
else
  err "Supabase CLI not found. Install it:"
  err "  npm install -g supabase"
  err "  -- or --"
  err "  npm install (it's in devDependencies)"
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Link to Supabase project
# ---------------------------------------------------------------------------
log "Linking to Supabase project: $SUPABASE_PROJECT_ID"

# Set the access token for non-interactive use
export SUPABASE_ACCESS_TOKEN

$SUPABASE_CMD link --project-ref "$SUPABASE_PROJECT_ID"

log "Linked successfully."

# ---------------------------------------------------------------------------
# 4. Set Edge Function secrets
# ---------------------------------------------------------------------------
log "Setting Edge Function secrets..."

$SUPABASE_CMD secrets set \
  "OPENAI_API_KEY=$OPENAI_API_KEY" \
  "VAPI_SERVER_URL_SECRET=$VAPI_SERVER_URL_SECRET" \
  "DATABASE_URL=$DATABASE_URL"

log "Secrets set."

# ---------------------------------------------------------------------------
# 5. Deploy the vapi-tools function
# ---------------------------------------------------------------------------
log "Deploying vapi-tools Edge Function..."

$SUPABASE_CMD functions deploy vapi-tools --no-verify-jwt

log "Edge Function deployed."

# ---------------------------------------------------------------------------
# 6. Health check
# ---------------------------------------------------------------------------
log "Running Edge Function health check..."

EDGE_URL="https://$SUPABASE_PROJECT_ID.functions.supabase.co/vapi-tools"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$EDGE_URL" \
  -H "Content-Type: application/json" \
  -H "x-vapi-secret: $VAPI_SERVER_URL_SECRET" \
  -d '{"message": {"type": "function-call", "functionCall": {"name": "ping"}}}' \
  --max-time 15 || echo "000")

if [ "$HTTP_CODE" = "000" ]; then
  err "Could not reach Edge Function at $EDGE_URL (connection failed)."
  err "The function may still be provisioning. Try again in a minute."
  exit 1
elif [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 500 ]; then
  log "Edge Function is responding (HTTP $HTTP_CODE)."
  log "URL: $EDGE_URL"
else
  err "Edge Function returned HTTP $HTTP_CODE. Check logs:"
  err "  $SUPABASE_CMD functions logs vapi-tools"
  exit 1
fi

log "Edge Functions deployment complete."
