#!/usr/bin/env bash
#
# scripts/example-pre-push-hook.sh
#
# Stronger pre-push hook. Project-type aware.
#
# Runs the full "checks" + "unitTests" commands from workflow.config.json.
# A Python project will run whatever its "checks" and "unitTests" are
# (e.g. ruff + black + pytest). Never hardcodes npm or tsc.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/config-reader.sh
source "$SCRIPT_DIR/config-reader.sh"

PTYPE="$(get_project_type)"

echo "==> Running pre-push checks (projectType: $PTYPE)..."

# ── Docs-only fast path ──────────────────────────────────────────────────────
# A push whose diff (vs the default branch) touches ONLY documentation never
# needs the unit suite — prose can't break a test. Detect it and skip the
# expensive unitTests below. The fast `checks` step still runs as a safety net,
# so even if this detection is ever wrong (a code file sneaks in), tsc/lint
# still catch it. Falls back to running everything when the diff can't be
# computed (e.g. default branch not fetched).
DOCS_ONLY=0
DEFAULT_REMOTE_BRANCH="origin/$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || echo main)"
CHANGED_FILES="$(git diff --name-only "$DEFAULT_REMOTE_BRANCH"...HEAD 2>/dev/null || true)"
if [ -n "$CHANGED_FILES" ] && ! printf '%s\n' "$CHANGED_FILES" | grep -qvE '(\.md$|\.mdx$|\.txt$|^docs/)'; then
    DOCS_ONLY=1
    echo "  📝 Docs-only push (vs $DEFAULT_REMOTE_BRANCH) — will skip the unit test suite."
fi

# Each command runs in its own subshell `( ... )` so a `cd` inside one step
# (e.g. `checks` ends with `cd dashboard && tsc`) can't leak its cwd into the
# next step. Without this, `unitTests` ("npm test") was silently running from
# dashboard/ — so the backend suite never ran on push.
CHECKS_CMD="$(get_command checks)"
if is_real_command "$CHECKS_CMD"; then
    echo "  - Running quality checks..."
    if ( eval "$CHECKS_CMD" ); then
        echo "    ✅ Quality checks passed"
    else
        echo "    ❌ Quality checks failed. Fix before pushing."
        exit 1
    fi
else
    echo "  - Quality checks (skipped — not defined for this projectType)"
fi

UNIT_CMD="$(get_command unitTests)"
if [ "$DOCS_ONLY" = "1" ]; then
    echo "  - Unit tests (skipped — docs-only push)"
elif is_real_command "$UNIT_CMD"; then
    echo "  - Running unit tests..."
    if ( eval "$UNIT_CMD" ); then
        echo "    ✅ Unit tests passed"
    else
        echo "    ❌ Some unit tests are failing. Fix before pushing."
        exit 1
    fi
else
    echo "  - Unit tests (skipped — not defined for this projectType)"
fi

echo "✅ Pre-push checks passed for projectType '$PTYPE'."
echo ""
E2E_CMD="$(get_command e2e)"
if is_real_command "$E2E_CMD"; then
    echo "Reminder: Consider running relevant E2E/integration tests before opening a PR:"
    echo "  $E2E_CMD \"<your-pattern>\""
fi
echo ""
exit 0
