#!/usr/bin/env bash
# fresh-clone-smoke.sh — periodic "fresh clone" rehearsal for CI rot prevention.
#
# Clones the repo into a temp directory and runs `npm run bootstrap` end-to-end.
# If it doesn't work from a cold state, that's CI rot in waiting — fix it
# before the next real PR hits the same wall. The four CI-rot bugs from
# 2026-05-11 (dashboard pg/bcrypt missing, shallow-clone strips drift-detector
# SHAs, deleted /supabase/functions still listed, index.test.ts hardcoded DB
# name) had all been latent for days-to-weeks; a periodic fresh-clone rehearsal
# would have caught every one.
#
# WHO   : developer running before a branch cut, or cron user running weekly
# WHAT  : git clone --depth 1 + npm run bootstrap (deps + DB + migrations
#         + seed + tests, backend + dashboard)
# WHEN  : intended cadence — once per week, OR before any branch cut, OR
#         after merging an infrastructure-touching PR
# WHERE : produces an ephemeral clone under $(mktemp -d); leaves the working
#         tree untouched
# WHY   : bootstrap rot accumulates silently — local dev caches mask missing
#         dependencies, stale migrations, and forgotten config files. The
#         only honest test of "can a new developer / CI runner / fresh
#         machine actually build this repo?" is to do exactly that.
#
# Usage:
#   bash scripts/fresh-clone-smoke.sh              # clone + bootstrap, clean up on exit
#   bash scripts/fresh-clone-smoke.sh --keep-dir   # leave the clone for inspection
#   bash scripts/fresh-clone-smoke.sh --remote URL # use a specific clone source
#
# Caveats:
# * The clone shares the local Docker DB (port 5433, container secretary-hq-db) with
#   the parent repo. test_db gets re-migrated + re-seeded — same destructive
#   behavior as `npm run bootstrap` in the working repo. Don't run this while
#   live work is mid-transaction against test_db.
# * Exit code 0 ⇒ fresh-clone PASS. Anything else ⇒ FAIL with stderr context.
#   Cron-friendly: capture stderr to a log file and email on non-zero exit.

set -euo pipefail

KEEP_DIR=0
REMOTE_OVERRIDE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --keep-dir)
            KEEP_DIR=1
            shift
            ;;
        --remote)
            REMOTE_OVERRIDE="${2:-}"
            if [[ -z "$REMOTE_OVERRIDE" ]]; then
                echo "fresh-clone-smoke: --remote requires a URL argument" >&2
                exit 2
            fi
            shift 2
            ;;
        -h|--help)
            sed -n '2,32p' "$0"
            exit 0
            ;;
        *)
            echo "fresh-clone-smoke: unknown argument: $1" >&2
            echo "fresh-clone-smoke: try --help" >&2
            exit 2
            ;;
    esac
done

# Resolve the repo URL. If --remote was passed, use it; otherwise read it from
# the script's parent git repo. This lets the script be invoked from inside the
# working tree without arguments AND from cron with an explicit URL.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -n "$REMOTE_OVERRIDE" ]]; then
    REMOTE_URL="$REMOTE_OVERRIDE"
else
    REMOTE_URL="$(git -C "$REPO_DIR" config --get remote.origin.url 2>/dev/null || true)"
    if [[ -z "$REMOTE_URL" ]]; then
        echo "fresh-clone-smoke: could not resolve remote URL from $REPO_DIR" >&2
        echo "fresh-clone-smoke: pass --remote <URL> explicitly" >&2
        exit 1
    fi
fi

TMP_DIR="$(mktemp -d -t secretary-hq-fresh-XXXXXX)"
START_TS="$(date +%s)"

cleanup() {
    local rc=$?
    local elapsed=$(( $(date +%s) - START_TS ))
    if [[ "$KEEP_DIR" -eq 0 ]]; then
        rm -rf "$TMP_DIR"
    else
        echo ""
        echo "fresh-clone-smoke: --keep-dir set; clone preserved at:"
        echo "  $TMP_DIR/secretary-hq"
    fi
    if [[ $rc -eq 0 ]]; then
        echo ""
        echo "fresh-clone-smoke: PASS  (elapsed: ${elapsed}s)"
    else
        echo ""
        echo "fresh-clone-smoke: FAIL  (exit $rc, elapsed: ${elapsed}s)" >&2
        echo "fresh-clone-smoke: re-run with --keep-dir to inspect the clone" >&2
    fi
    exit $rc
}
trap cleanup EXIT

echo "fresh-clone-smoke: cloning $REMOTE_URL"
echo "fresh-clone-smoke: target: $TMP_DIR/secretary-hq"
# --depth 1 keeps the clone cheap. If a step inside bootstrap needs deeper
# history (e.g., the drift detector resolving an old commit by SHA), that
# is itself CI rot worth surfacing — the May 11 lesson.
git clone --depth 1 "$REMOTE_URL" "$TMP_DIR/secretary-hq"

cd "$TMP_DIR/secretary-hq"

echo ""
echo "fresh-clone-smoke: running 'npm run bootstrap' in the clone"
echo "----------------------------------------------------------"
npm run bootstrap
