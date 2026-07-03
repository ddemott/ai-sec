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
# A push whose changes touch ONLY documentation never needs the unit suite —
# prose can't break a test. Skip the expensive unitTests below; the fast
# `checks` step still runs as a safety net.
#
# Git pipes the refs being pushed on the hook's stdin, one per line:
#   <local ref> <local sha> <remote ref> <remote sha>
# We classify off the ACTUAL pushed SHA range — not HEAD — so `git push origin
# other` (a ref that isn't checked out) is judged correctly. The fast path is
# enabled ONLY for a single-ref push whose exact range (remote sha → local sha)
# is all docs. ANY ambiguity — multiple refs (--all), a branch deletion, no
# stdin (hook run by hand from a terminal), an unreadable range — falls back to
# running the full suite.
DOCS_ONLY=0
ZERO='0000000000000000000000000000000000000000'
if [ ! -t 0 ]; then
    STDIN_REFS="$(cat)"                  # the pushed-ref list (empty when no stdin)
    REF_COUNT="$(printf '%s\n' "$STDIN_REFS" | grep -c '[^[:space:]]' || true)"
    if [ "$REF_COUNT" = "1" ]; then
        # shellcheck disable=SC2034
        read -r _lref lsha _rref rsha <<EOF_REF
$STDIN_REFS
EOF_REF
        if [ -n "${lsha:-}" ] && [ "$lsha" != "$ZERO" ]; then
            if [ "${rsha:-$ZERO}" = "$ZERO" ]; then
                # New branch (no remote counterpart yet): diff vs the default branch.
                BASE="origin/$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || echo main)"
            else
                BASE="$rsha"             # existing branch: diff the exact pushed range
            fi
            CHANGED_FILES="$(git diff --name-only "$BASE" "$lsha" 2>/dev/null || true)"
            if [ -n "$CHANGED_FILES" ] && ! printf '%s\n' "$CHANGED_FILES" | grep -qvE '(\.md$|\.mdx$|\.txt$|^docs/)'; then
                DOCS_ONLY=1
                echo "  📝 Docs-only push — will skip the unit test suite."
            fi
        fi
    fi
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
