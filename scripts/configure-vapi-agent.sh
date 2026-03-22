#!/usr/bin/env bash
set -euo pipefail

# configure-vapi-agent.sh: Creates a Vapi agent from the template for a tenant.
#
# Required env vars:
#   SUPABASE_PROJECT_ID     - Supabase project ID (for server URL)
#   VAPI_SERVER_URL_SECRET  - Shared secret for webhook auth
#
# Required arguments or env vars:
#   TENANT_NAME     - Business name (e.g., "DynaTire")
#   TENANT_ID       - Tenant UUID from the tenants table
#   BUSINESS_TYPE   - e.g., "tire shop", "salon", "auto shop"
#   RESOURCE_ID     - Default resource UUID
#
# Optional:
#   VAPI_API_KEY    - If set, creates the agent via Vapi API
#   VOICE_PROVIDER  - TTS provider (default: cartesia)
#   VOICE_ID        - Voice ID (default: Cartesia's default)
#   SERVICE_DESCRIPTION - What the business does (auto-generated if not set)
#
# Usage:
#   TENANT_NAME="DynaTire" TENANT_ID="f234..." BUSINESS_TYPE="tire shop" RESOURCE_ID="abc..." \
#     ./scripts/configure-vapi-agent.sh
#
#   Or with Vapi API key to auto-create:
#   VAPI_API_KEY="va-..." ./scripts/configure-vapi-agent.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$ROOT_DIR"

log() { echo "[ai-sec] $1"; }
err() { echo "[ai-sec] ERROR: $1" >&2; }

TEMPLATE="$ROOT_DIR/vapi/agent.template.json"

# ---------------------------------------------------------------------------
# 1. Validate
# ---------------------------------------------------------------------------
if [ ! -f "$TEMPLATE" ]; then
  err "Agent template not found at $TEMPLATE"
  exit 1
fi

REQUIRED_VARS=(SUPABASE_PROJECT_ID VAPI_SERVER_URL_SECRET TENANT_NAME TENANT_ID BUSINESS_TYPE RESOURCE_ID)
MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    MISSING+=("$var")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  err "Missing required variables:"
  for var in "${MISSING[@]}"; do
    err "  - $var"
  done
  err ""
  err "Usage example:"
  err "  TENANT_NAME=\"DynaTire\" TENANT_ID=\"f234e471-...\" BUSINESS_TYPE=\"tire shop\" \\"
  err "  RESOURCE_ID=\"abc-123-...\" SUPABASE_PROJECT_ID=\"xyz\" VAPI_SERVER_URL_SECRET=\"secret\" \\"
  err "  ./scripts/configure-vapi-agent.sh"
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  err "'curl' is not installed."
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Set defaults for optional vars
# ---------------------------------------------------------------------------
VOICE_PROVIDER="${VOICE_PROVIDER:-cartesia}"
VOICE_ID="${VOICE_ID:-a0e99841-438c-4a64-b679-ae501e7d6091}"
SERVICE_DESCRIPTION="${SERVICE_DESCRIPTION:-services related to $BUSINESS_TYPE}"
CURRENT_DATE="$(date +%Y-%m-%d)"
SERVER_URL="https://$SUPABASE_PROJECT_ID.functions.supabase.co/vapi-tools"
SERVER_URL_SECRET="$VAPI_SERVER_URL_SECRET"

# ---------------------------------------------------------------------------
# 3. Replace template variables
# ---------------------------------------------------------------------------
log "Generating Vapi agent config from template..."

AGENT_JSON=$(cat "$TEMPLATE")

# Replace mustache variables
AGENT_JSON="${AGENT_JSON//\{\{TENANT_NAME\}\}/$TENANT_NAME}"
AGENT_JSON="${AGENT_JSON//\{\{TENANT_ID\}\}/$TENANT_ID}"
AGENT_JSON="${AGENT_JSON//\{\{BUSINESS_TYPE\}\}/$BUSINESS_TYPE}"
AGENT_JSON="${AGENT_JSON//\{\{RESOURCE_ID\}\}/$RESOURCE_ID}"
AGENT_JSON="${AGENT_JSON//\{\{CURRENT_DATE\}\}/$CURRENT_DATE}"
AGENT_JSON="${AGENT_JSON//\{\{VOICE_PROVIDER\}\}/$VOICE_PROVIDER}"
AGENT_JSON="${AGENT_JSON//\{\{VOICE_ID\}\}/$VOICE_ID}"
AGENT_JSON="${AGENT_JSON//\{\{SERVER_URL\}\}/$SERVER_URL}"
AGENT_JSON="${AGENT_JSON//\{\{SERVER_URL_SECRET\}\}/$SERVER_URL_SECRET}"
AGENT_JSON="${AGENT_JSON//\{\{SERVICE_DESCRIPTION\}\}/$SERVICE_DESCRIPTION}"

log "Template variables replaced:"
log "  Tenant:       $TENANT_NAME ($TENANT_ID)"
log "  Business:     $BUSINESS_TYPE"
log "  Resource:     $RESOURCE_ID"
log "  Voice:        $VOICE_PROVIDER / $VOICE_ID"
log "  Server URL:   $SERVER_URL"
log "  Date:         $CURRENT_DATE"

# ---------------------------------------------------------------------------
# 4. Output or create via API
# ---------------------------------------------------------------------------
OUTPUT_FILE="$ROOT_DIR/vapi/agent-${TENANT_NAME,,}.json"
# Normalize filename: lowercase, replace spaces with hyphens
OUTPUT_FILE="${OUTPUT_FILE// /-}"

echo "$AGENT_JSON" > "$OUTPUT_FILE"
log "Agent config written to: $OUTPUT_FILE"

if [ -n "${VAPI_API_KEY:-}" ]; then
  log "VAPI_API_KEY detected. Creating agent via Vapi API..."

  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "https://api.vapi.ai/assistant" \
    -H "Authorization: Bearer $VAPI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$AGENT_JSON" \
    --max-time 30)

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | head -n -1)

  if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
    AGENT_ID=$(echo "$BODY" | grep -oP '"id"\s*:\s*"[^"]*"' | head -1 | grep -oP '"[^"]*"$' | tr -d '"')
    log "Agent created successfully!"
    log "  Agent ID: $AGENT_ID"
    log "  Next: Assign a phone number to this agent in the Vapi dashboard."
  else
    err "Vapi API returned HTTP $HTTP_CODE:"
    echo "$BODY" >&2
    err ""
    err "The agent config has been saved to $OUTPUT_FILE"
    err "You can import it manually via the Vapi dashboard."
    exit 1
  fi

else
  log ""
  log "No VAPI_API_KEY set. To create the agent:"
  log ""
  log "  Option A: Set VAPI_API_KEY and re-run this script"
  log "  Option B: Import $OUTPUT_FILE via the Vapi dashboard"
  log "            (https://dashboard.vapi.ai > Assistants > Import)"
  log ""
fi

log "Vapi agent configuration complete."
