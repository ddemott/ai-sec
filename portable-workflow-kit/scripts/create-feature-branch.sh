#!/usr/bin/env bash
#
# scripts/create-feature-branch.sh
#
# Creates a properly named feature branch from the latest main,
# following the project's Development Workflow.
#
# This is the portable version. It reads workflow.config.json via
# config-reader.sh so the "initial quality gates" step is appropriate
# for whatever projectType the repo has declared (node-fullstack, python,
# generic, or a custom mixed monorepo).
#
# Usage:
#   ./scripts/create-feature-branch.sh feat/my-cool-thing
#   ./scripts/create-feature-branch.sh fix/some-bug
#
# It will:
#   1. Checkout main and pull latest
#   2. Create the new branch
#   3. Copy BRANCH_CHECKLIST.md for local tracking
#   4. Run the project-appropriate initial quality gates (from config)
#   5. Print useful next-step guidance

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <branch-name>"
  echo "Example: $0 feat/e2e-coverage-gaps"
  echo "         $0 fix/some-bug"
  exit 1
fi

BRANCH_NAME="$1"

# Basic validation of branch name
if [[ ! "$BRANCH_NAME" =~ ^(feat|fix|test|refactor|docs|chore)/ ]]; then
  echo "Error: Branch name should start with one of: feat/, fix/, test/, refactor/, docs/, chore/"
  echo "You provided: $BRANCH_NAME"
  exit 1
fi

echo "==> Fetching latest main..."
git fetch origin main

echo "==> Checking out main and pulling..."
git checkout main
git pull origin main

echo "==> Creating branch: $BRANCH_NAME"
git checkout -b "$BRANCH_NAME"

# Copy the standard branch checklist into the new branch for local tracking
if [ -f "docs/BRANCH_CHECKLIST.md" ]; then
  cp docs/BRANCH_CHECKLIST.md BRANCH_CHECKLIST.md
  echo "==> Copied BRANCH_CHECKLIST.md into the branch root for tracking"
fi

echo ""
echo "✅ Branch created: $(git branch --show-current)"
echo ""

echo "==> Running initial automated quality gates (via workflow.config.json)..."
echo ""

# Use the portable config system when available (preferred)
if [ -f "scripts/config-reader.sh" ]; then
    # shellcheck source=scripts/config-reader.sh
    source "scripts/config-reader.sh" 2>/dev/null || true

    PTYPE="$(get_project_type 2>/dev/null || echo 'unknown')"
    echo "    projectType: $PTYPE"

    CHECKS_CMD="$(get_command checks 2>/dev/null || true)"
    if is_real_command "$CHECKS_CMD"; then
        echo "    Running configured checks command..."
        eval "$CHECKS_CMD" 2>&1 | tail -12 || true
    else
        echo "    (no real 'checks' command defined in workflow.config.json — skipping)"
    fi

    BUILD_CMD="$(get_command build 2>/dev/null || true)"
    if is_real_command "$BUILD_CMD"; then
        echo ""
        echo "    Running configured build command..."
        eval "$BUILD_CMD" 2>&1 | tail -8 || true
    fi
else
    echo "    (scripts/config-reader.sh not present — using fallback)"
    # Very old / minimal adoption fallback
    if npm run --silent checks --if-present 2>/dev/null; then
        npm run checks 2>&1 | tail -8 || true
    fi
    if npm run --silent build --if-present 2>/dev/null; then
        npm run build 2>&1 | tail -5 || true
    fi
fi

echo ""
echo "Initial quality gates completed."
echo ""

echo "Recommended next steps:"
echo "  1. Review any failures or warnings from the checks/build above."
echo ""
echo "  2. Update the documentation files listed under"
echo "     workflow.config.json → documentation.filesThatMustBeUpdated"
echo ""
echo "  3. Edit BRANCH_CHECKLIST.md (now in this branch root) to track your progress."
echo ""
echo "  4. When you're ready to commit, run:"
echo "     npm run prepare-commit"
echo "     (This runs the full automated portion defined in your workflow.config.json.)"
echo ""
echo "  5. Then use your normal commit process with the agent"
echo "     (usually just saying \"commit\" or \"commit code\")."
echo ""
echo "The whole system is driven by workflow.config.json in the project root."
echo "Edit the 'commands' block there to tune checks, tests, etc. for this repo."
echo ""
echo "Happy coding!"