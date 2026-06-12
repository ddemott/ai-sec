#!/usr/bin/env bash
#
# scripts/simulate.sh — On-demand system simulation + status harness.
#
# One control panel to answer "are all systems up?" and "does the whole thing
# actually work?" at any time, against local dev OR production.
#
# Subcommands:
#   status [--env local|prod] [--deep]   HTTP health board for every service.
#                                        --deep also dispatch-tests the agent
#                                        worker via LiveKit (spins a real
#                                        session, ~5s, cleans up after).
#   tools  [--env local|prod] [--tenant <id>]
#                                        Functional simulation of everything the
#                                        voice agent DOES on a call (lookup,
#                                        book, OTP, preferences, session log) by
#                                        hitting /agent-tools/* — no telephony.
#                                        Defaults to a fresh /demo/start tenant
#                                        (ephemeral, 30-min TTL, self-cleaning).
#   call   [--env local|prod] --tenant <id>
#                                        Dispatch the agent into a LiveKit room
#                                        and print a browser join URL so you can
#                                        talk to the agent with a mic — real
#                                        STT/LLM/TTS/booking, NO phone needed.
#   all    [--env local|prod]            status --deep, then tools.
#
# Env/secrets are read from the repo .env (local) or passed in (prod). The
# tiers map to: status = "systems up", tools = "brain works", call = "voice
# works without a phone". The only thing this CANNOT simulate is real PSTN
# inbound (Telnyx) — that needs a real carrier call.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"

# ── Colors ──────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; DIM=''; BOLD=''; RESET=''
fi

ok()   { printf "  ${GREEN}[OK]${RESET}   %-22s %s\n" "$1" "$2"; }
fail() { printf "  ${RED}[FAIL]${RESET} %-22s %s\n" "$1" "$2"; }
skip() { printf "  ${DIM}[--]   %-22s %s${RESET}\n" "$1" "$2"; }

# ── Arg parsing ─────────────────────────────────────────────────────────────
ENV="local"
DEEP=0
TENANT=""
SUBCMD="${1:-}"
shift || true

while [ $# -gt 0 ]; do
  case "$1" in
    --env)    ENV="$2"; shift 2 ;;
    --deep)   DEEP=1; shift ;;
    --tenant) TENANT="$2"; shift 2 ;;
    -h|--help) sed -n '3,40p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

# ── Targets per env ─────────────────────────────────────────────────────────
case "$ENV" in
  local)
    BACKEND="https://localhost:4001"
    DASHBOARD="https://localhost:4000"
    CURL_OPTS="-sk"   # -k: local uses self-signed certs
    ;;
  prod)
    BACKEND="https://ai-sec-production.up.railway.app"
    DASHBOARD="https://dashboard-production-cee3.up.railway.app"
    CURL_OPTS="-s"
    ;;
  *) echo "Unknown env: $ENV (use local|prod)" >&2; exit 2 ;;
esac

# Pull a value out of a flat JSON blob without jq.
json_get() { echo "$1" | grep -oE "\"$2\":\"?[^\",}]*\"?" | head -1 | sed -E "s/\"$2\"://; s/\"//g"; }

# Read one var from the repo .env (cut -f2- so values with '=' survive; strip quotes).
env_get() { grep -E "^$1=" "$ROOT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'\'''; }

# Export LIVEKIT_* from .env for the node helpers.
load_livekit_env() {
  LK_URL="$(env_get LIVEKIT_URL)"; LK_KEY="$(env_get LIVEKIT_API_KEY)"; LK_SECRET="$(env_get LIVEKIT_API_SECRET)"
  if [ -z "$LK_URL" ] || [ -z "$LK_KEY" ] || [ -z "$LK_SECRET" ]; then
    echo "  ${RED}LIVEKIT_URL/API_KEY/API_SECRET not found in $ROOT_DIR/.env${RESET}" >&2
    return 1
  fi
}

# ── status ──────────────────────────────────────────────────────────────────
cmd_status() {
  printf "${BOLD}SecretaryHQ — System Status${RESET} ${DIM}(env: %s)${RESET}\n" "$ENV"
  local up=0 total=0

  # 1. Backend liveness
  total=$((total+1))
  local health; health="$(curl $CURL_OPTS --max-time 8 "$BACKEND/health" 2>/dev/null || true)"
  if echo "$health" | grep -q '"status":"ok"'; then
    ok "backend /health" "up since $(json_get "$health" started_at)"
    up=$((up+1))
  else
    fail "backend /health" "no response from $BACKEND"
  fi

  # 2. Backend readiness (DB ping + pool)
  total=$((total+1))
  local ready; ready="$(curl $CURL_OPTS --max-time 8 "$BACKEND/ready" 2>/dev/null || true)"
  if echo "$ready" | grep -q '"db":"ok"'; then
    local pool; pool="$(echo "$ready" | grep -oE '"pool":\{[^}]*\}')"
    ok "backend /ready" "db ok $(json_get "$ready" latency_ms)ms ${DIM}${pool}${RESET}"
    up=$((up+1))
  else
    fail "backend /ready" "DB unreachable (${ready:-no response})"
  fi

  # 3. Dashboard reachability
  total=$((total+1))
  local code; code="$(curl $CURL_OPTS --max-time 8 -o /dev/null -w '%{http_code}' "$DASHBOARD/" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    ok "dashboard" "HTTP 200"
    up=$((up+1))
  else
    fail "dashboard" "HTTP $code from $DASHBOARD"
  fi

  # 4. Agent worker (deep — real LiveKit dispatch into a throwaway room)
  total=$((total+1))
  if [ "$DEEP" = "1" ]; then
    # LiveKit creds from .env → node helper (resolves livekit-server-sdk from agent/node_modules).
    if load_livekit_env && \
       LIVEKIT_URL="$LK_URL" LIVEKIT_API_KEY="$LK_KEY" LIVEKIT_API_SECRET="$LK_SECRET" \
       SIM_TENANT="${TENANT:-}" \
       node "$ROOT_DIR/agent/scripts/sim-agent-liveness.mjs"; then
      ok "agent worker" "dispatch picked up (LiveKit)"
      up=$((up+1))
    else
      fail "agent worker" "no participant joined within timeout (see above)"
    fi
  else
    skip "agent worker" "pass --deep to dispatch-test the LiveKit worker"
    total=$((total-1))  # not counted unless deep-checked
  fi

  printf "${BOLD}Result:${RESET} %s/%s core checks up\n" "$up" "$total"
  [ "$up" = "$total" ]
}

# ── tools ───────────────────────────────────────────────────────────────────
cmd_tools() {
  # Server's AGENT_SECRET. From .env (matches the LOCAL backend). For prod,
  # the prod secret differs — allow override via SIM_AGENT_SECRET in the env.
  local secret="${SIM_AGENT_SECRET:-$(env_get AGENT_SECRET)}"
  if [ -z "$secret" ]; then
    echo "  ${RED}AGENT_SECRET not found (.env) and SIM_AGENT_SECRET not set${RESET}" >&2
    exit 1
  fi
  if [ "$ENV" = "prod" ] && [ -z "${SIM_AGENT_SECRET:-}" ]; then
    echo "  ${YELLOW}note:${RESET} using the .env (local) AGENT_SECRET against prod — agent-tools will 401" >&2
    echo "  ${YELLOW}      unless it matches prod's. Set SIM_AGENT_SECRET=<prod secret> to target prod.${RESET}" >&2
  fi
  # Local backend uses self-signed certs → let node fetch accept them.
  local tls=""
  [ "$ENV" = "local" ] && tls="NODE_TLS_REJECT_UNAUTHORIZED=0"
  env $tls SIM_BACKEND="$BACKEND" SIM_AGENT_SECRET="$secret" SIM_TENANT="${TENANT:-}" \
    node "$ROOT_DIR/scripts/sim-tools.mjs"
}

# ── call ────────────────────────────────────────────────────────────────────
cmd_call() {
  load_livekit_env || exit 1
  LIVEKIT_URL="$LK_URL" LIVEKIT_API_KEY="$LK_KEY" LIVEKIT_API_SECRET="$LK_SECRET" \
    SIM_TENANT="${TENANT:-}" \
    node "$ROOT_DIR/agent/scripts/sim-call.mjs"
}

case "$SUBCMD" in
  status) cmd_status ;;
  tools)  cmd_tools ;;
  call)   cmd_call ;;
  all)    cmd_status && echo "" && cmd_tools ;;
  ""|-h|--help) sed -n '3,40p' "$0" ;;
  *) echo "Unknown subcommand: $SUBCMD" >&2; exit 2 ;;
esac
