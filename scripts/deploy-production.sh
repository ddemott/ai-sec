#!/usr/bin/env bash
set -euo pipefail

# deploy-production.sh: Master deployment orchestrator for AI Secretary SaaS.
# Usage: ./scripts/deploy-production.sh .env.production
#
# Required env vars in .env.production:
#   DATABASE_URL          - Supabase Postgres direct connection string
#   SUPABASE_PROJECT_ID   - Supabase project reference ID
#   SUPABASE_ACCESS_TOKEN - Supabase personal access token
#   OPENAI_API_KEY        - OpenAI API key for embeddings
#   VAPI_SERVER_URL_SECRET - Shared secret for Vapi webhook auth
#   JWT_SECRET            - Secret for signing JWT tokens
#   STRIPE_SECRET_KEY     - Stripe live secret key
#   STRIPE_WEBHOOK_SECRET - Stripe webhook signing secret
#   STRIPE_SOLO_PRICE_ID  - Stripe price ID for Solo plan
#   STRIPE_GROWTH_PRICE_ID - Stripe price ID for Growth plan
#   NEXT_PUBLIC_API_BASE_URL - Public URL of the deployed backend
#   ADMIN_EMAIL           - Email for initial admin account
#   ADMIN_PASSWORD        - Password for initial admin account

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$ROOT_DIR"

log() { echo "[ai-sec] $1"; }
err() { echo "[ai-sec] ERROR: $1" >&2; }
step() { echo ""; echo "========================================"; echo "[ai-sec] STEP $1: $2"; echo "========================================"; }

# ---------------------------------------------------------------------------
# 0. Parse arguments
# ---------------------------------------------------------------------------
ENV_FILE="${1:-}"

if [ -z "$ENV_FILE" ]; then
  err "Usage: ./scripts/deploy-production.sh <path-to-.env.production>"
  err "Example: ./scripts/deploy-production.sh .env.production"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  err "Environment file not found: $ENV_FILE"
  err "Copy .env.production.example to .env.production and fill in your values."
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Validate required env vars
# ---------------------------------------------------------------------------
step "1" "Validating environment variables"

# Source the env file (skip comments and empty lines)
set -a
while IFS='=' read -r key value; do
  # Skip comments, empty lines, and lines without =
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  # Trim whitespace from key
  key="$(echo "$key" | xargs)"
  [ -z "$key" ] && continue
  export "$key"="$value"
done < <(grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$')
set +a

REQUIRED_VARS=(
  DATABASE_URL
  SUPABASE_PROJECT_ID
  SUPABASE_ACCESS_TOKEN
  OPENAI_API_KEY
  VAPI_SERVER_URL_SECRET
  JWT_SECRET
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_SOLO_PRICE_ID
  STRIPE_GROWTH_PRICE_ID
  NEXT_PUBLIC_API_BASE_URL
  ADMIN_EMAIL
  ADMIN_PASSWORD
)

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
  exit 1
fi

# Safety checks
if [ "$JWT_SECRET" = "dev-jwt-secret-change-in-production" ] || [ "$JWT_SECRET" = "generate-a-strong-random-string-at-least-32-chars" ]; then
  err "JWT_SECRET is still set to a placeholder value. Generate a strong random string."
  exit 1
fi

if [ "$ADMIN_PASSWORD" = "change-this-to-something-secure" ] || [ "$ADMIN_PASSWORD" = "password" ]; then
  err "ADMIN_PASSWORD is insecure. Choose a strong password."
  exit 1
fi

log "All ${#REQUIRED_VARS[@]} required variables present."

# Export for sub-scripts
export DATABASE_URL SUPABASE_PROJECT_ID SUPABASE_ACCESS_TOKEN OPENAI_API_KEY
export VAPI_SERVER_URL_SECRET JWT_SECRET JWT_EXPIRY="${JWT_EXPIRY:-8h}"
export STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_SOLO_PRICE_ID STRIPE_GROWTH_PRICE_ID
export NEXT_PUBLIC_API_BASE_URL ADMIN_EMAIL ADMIN_PASSWORD
export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-3000}"

# ---------------------------------------------------------------------------
# 2. Check required tools
# ---------------------------------------------------------------------------
step "2" "Checking required tools"

TOOLS_REQUIRED=(psql node npm curl npx)
for tool in "${TOOLS_REQUIRED[@]}"; do
  if command -v "$tool" >/dev/null 2>&1; then
    log "  $tool: found"
  else
    err "Required tool '$tool' is not installed."
    exit 1
  fi
done

NODE_VER="$(node --version)"
log "  Node.js version: $NODE_VER"

# ---------------------------------------------------------------------------
# 3. Preflight checks
# ---------------------------------------------------------------------------
step "3" "Running preflight checks against cloud database"

if ! "$ROOT_DIR/scripts/preflight-cloud.sh" "$DATABASE_URL"; then
  err "Preflight checks failed. Fix the issues above before deploying."
  exit 1
fi

log "Preflight checks passed."

# ---------------------------------------------------------------------------
# 4. Database migrations & seed
# ---------------------------------------------------------------------------
step "4" "Applying database migrations and seed data"

"$ROOT_DIR/scripts/setup-db.sh" "$DATABASE_URL"

log "Database migrations complete."

# ---------------------------------------------------------------------------
# 5. Create admin user
# ---------------------------------------------------------------------------
step "5" "Creating admin user"

# Generate bcrypt hash using node
ADMIN_HASH=$(node -e "
const bcrypt = require('bcrypt');
bcrypt.hash(process.env.ADMIN_PASSWORD, 10).then(h => process.stdout.write(h));
")

# The platform admin tenant is the super-admin UUID
PLATFORM_TENANT="00000000-0000-0000-0000-000000000000"

# Upsert the admin user (idempotent)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  INSERT INTO users (tenant_id, email, password_hash, role)
  VALUES ('$PLATFORM_TENANT', '$ADMIN_EMAIL', '$ADMIN_HASH', 'platform_admin')
  ON CONFLICT (email)
  DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role;
" > /dev/null

log "Admin user created/updated: $ADMIN_EMAIL"

# ---------------------------------------------------------------------------
# 6. Deploy Edge Functions
# ---------------------------------------------------------------------------
step "6" "Deploying Supabase Edge Functions"

"$ROOT_DIR/scripts/deploy-edge-functions.sh"

log "Edge Functions deployed."

# ---------------------------------------------------------------------------
# 7. Deploy Backend
# ---------------------------------------------------------------------------
step "7" "Deploying Backend API"

"$ROOT_DIR/scripts/deploy-backend.sh"

log "Backend deployment step complete."

# ---------------------------------------------------------------------------
# 8. Deploy Dashboard
# ---------------------------------------------------------------------------
step "8" "Deploying Dashboard"

"$ROOT_DIR/scripts/deploy-dashboard.sh"

log "Dashboard deployment step complete."

# ---------------------------------------------------------------------------
# 9. Smoke tests
# ---------------------------------------------------------------------------
step "9" "Running smoke tests"

BACKEND_URL="${NEXT_PUBLIC_API_BASE_URL}"
if "$ROOT_DIR/scripts/smoke-test.sh" "$BACKEND_URL"; then
  log "Smoke tests passed."
else
  err "Some smoke tests failed. Check output above."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "========================================================"
echo " AI Secretary - Production Deployment Complete"
echo "========================================================"
echo ""
echo " Backend API:     $NEXT_PUBLIC_API_BASE_URL"
echo " Edge Functions:  https://$SUPABASE_PROJECT_ID.functions.supabase.co/vapi-tools"
echo " Database:        (connected via DATABASE_URL)"
echo " Admin login:     $ADMIN_EMAIL"
echo ""
echo " Next steps:"
echo "   1. Configure Vapi agent: ./scripts/configure-vapi-agent.sh"
echo "   2. Set up Telnyx phone number (see docs/DEPLOYMENT.md Phase 6)"
echo "   3. Configure n8n workflows (see docs/DEPLOYMENT.md Phase 7)"
echo "   4. Run a live call test"
echo ""
echo " Security reminders:"
echo "   - Change the default seeded password (dale@ai-sec.com / password)"
echo "   - Restrict CORS to your dashboard domain"
echo "   - Verify RLS is enabled on all tenant-scoped tables"
echo ""
log "Done."
