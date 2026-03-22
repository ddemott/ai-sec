#!/usr/bin/env bash
set -euo pipefail

# deploy-backend.sh: Builds and deploys the Fastify backend for SecretaryHQ.
# Detects available platform CLIs (Railway, Fly.io) or prints manual instructions.
#
# Requires env vars: DATABASE_URL, OPENAI_API_KEY, VAPI_SERVER_URL_SECRET,
#                    JWT_SECRET, NODE_ENV, PORT
#
# Can be run standalone or called from deploy-production.sh.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
cd "$ROOT_DIR"

log() { echo "[secretaryhq] $1"; }
err() { echo "[secretaryhq] ERROR: $1" >&2; }

# ---------------------------------------------------------------------------
# 1. Check required tools
# ---------------------------------------------------------------------------
for tool in node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    err "'$tool' is not installed."
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# 2. Install dependencies
# ---------------------------------------------------------------------------
log "Installing production dependencies..."
npm ci --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev

# Re-install all deps for build (we need devDependencies for tsc)
log "Installing all dependencies for build..."
npm ci 2>/dev/null || npm install

# ---------------------------------------------------------------------------
# 3. Build TypeScript
# ---------------------------------------------------------------------------
log "Building backend (tsc)..."
npm run build

if [ ! -f "$ROOT_DIR/dist/src/index.js" ]; then
  err "Build failed: dist/src/index.js not found."
  exit 1
fi

log "Build successful: dist/src/index.js"

# ---------------------------------------------------------------------------
# 4. Create Dockerfile if it doesn't exist
# ---------------------------------------------------------------------------
if [ ! -f "$ROOT_DIR/Dockerfile" ]; then
  log "Creating Dockerfile..."
  cat > "$ROOT_DIR/Dockerfile" << 'DOCKERFILE'
# SecretaryHQ Backend - Production Dockerfile
FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
COPY shared/ ./shared/
RUN npm run build

# --- Production stage ---
FROM node:20-slim

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built output
COPY --from=builder /app/dist/ ./dist/

# Non-root user for security
RUN addgroup --system app && adduser --system --ingroup app app
USER app

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "dist/src/index.js"]
DOCKERFILE
  log "Dockerfile created at $ROOT_DIR/Dockerfile"
else
  log "Dockerfile already exists, skipping creation."
fi

# ---------------------------------------------------------------------------
# 5. Create .dockerignore if it doesn't exist
# ---------------------------------------------------------------------------
if [ ! -f "$ROOT_DIR/.dockerignore" ]; then
  cat > "$ROOT_DIR/.dockerignore" << 'IGNORE'
node_modules
dashboard
supabase
docs
certs
n8n
vapi
scripts
.env*
*.md
.git
dist
IGNORE
  log ".dockerignore created."
fi

# ---------------------------------------------------------------------------
# 6. Platform-specific deployment
# ---------------------------------------------------------------------------
ENV_VARS_LIST="
  DATABASE_URL
  OPENAI_API_KEY
  VAPI_SERVER_URL_SECRET
  JWT_SECRET
  JWT_EXPIRY
  NODE_ENV
  PORT
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_SOLO_PRICE_ID
  STRIPE_GROWTH_PRICE_ID
"

if command -v railway >/dev/null 2>&1; then
  # --- Railway CLI detected ---
  log "Railway CLI detected. Deploying to Railway..."

  log "Setting environment variables..."
  for var in $ENV_VARS_LIST; do
    val="${!var:-}"
    if [ -n "$val" ]; then
      railway variables set "$var=$val" 2>/dev/null || true
    fi
  done

  log "Deploying..."
  railway up --detach

  log "Railway deployment initiated. Check status with: railway status"
  log "Get your public URL with: railway domain"

elif command -v fly >/dev/null 2>&1; then
  # --- Fly.io CLI detected ---
  log "Fly.io CLI detected."

  if [ ! -f "$ROOT_DIR/fly.toml" ]; then
    log "No fly.toml found. Creating app..."
    fly launch --no-deploy --name ai-sec-backend --region iad
  fi

  log "Setting secrets..."
  FLY_SECRETS=""
  for var in $ENV_VARS_LIST; do
    val="${!var:-}"
    if [ -n "$val" ]; then
      FLY_SECRETS="$FLY_SECRETS $var=$val"
    fi
  done
  if [ -n "$FLY_SECRETS" ]; then
    fly secrets set $FLY_SECRETS
  fi

  log "Deploying..."
  fly deploy

  log "Fly.io deployment complete."

else
  # --- No platform CLI found ---
  log "No platform CLI detected (railway, fly)."
  log ""
  log "The backend has been built successfully. To deploy:"
  log ""
  log "=== Option A: Railway (recommended) ==="
  log "  1. Install CLI: npm install -g @railway/cli"
  log "  2. Login: railway login"
  log "  3. Init: railway init"
  log "  4. Re-run this script, or: railway up"
  log ""
  log "=== Option B: Render ==="
  log "  1. Go to https://render.com and create a new Web Service"
  log "  2. Connect your GitHub repository"
  log "  3. Build command: npm install && npm run build"
  log "  4. Start command: node dist/src/index.js"
  log "  5. Set environment variables (see below)"
  log ""
  log "=== Option C: Fly.io ==="
  log "  1. Install CLI: curl -L https://fly.io/install.sh | sh"
  log "  2. Login: fly auth login"
  log "  3. Launch: fly launch"
  log "  4. Re-run this script, or: fly deploy"
  log ""
  log "=== Option D: Docker (any host) ==="
  log "  docker build -t ai-sec-backend ."
  log "  docker run -p 3000:3000 --env-file .env.production ai-sec-backend"
  log ""
  log "=== Required environment variables ==="
  for var in $ENV_VARS_LIST; do
    val="${!var:-}"
    if [ -n "$val" ]; then
      # Mask sensitive values
      if [[ "$var" == *SECRET* ]] || [[ "$var" == *KEY* ]] || [[ "$var" == *PASSWORD* ]] || [[ "$var" == *URL* && "$var" == *DATABASE* ]]; then
        echo "  $var=${val:0:8}..."
      else
        echo "  $var=$val"
      fi
    else
      echo "  $var=(not set)"
    fi
  done
fi

log "Backend deployment step complete."
