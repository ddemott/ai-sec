#!/usr/bin/env bash
#
# scripts/example-pre-commit-hook.sh
#
# Example local pre-commit hook for lightweight enforcement.
# This runs BEFORE git commit is allowed.
#
# Features:
#   - Only checks files that are actually staged (much faster + relevant)
#   - Uses the project's existing npm scripts
#   - Fails the commit if checks fail
#
# This script is called by the Husky-managed hook in .husky/pre-commit
# (installed automatically on `npm install` via the "prepare" script).
#
# You can also run it manually for testing:
#   bash scripts/example-pre-commit-hook.sh
#
# Philosophy:
#   This is early, fast feedback only.
#   Heavy lifting (full test suites, E2E, docs review) happens via
#   `npm run pre-pr` and the commit-code process before opening a PR.

set -euo pipefail

# Get list of staged files (added, modified, renamed, etc.)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(ts|tsx|js|jsx|json|md)$' || true)

if [ -z "$STAGED_FILES" ]; then
  echo "No relevant staged files to check. Skipping pre-commit hooks."
  exit 0
fi

echo "==> Running pre-commit checks on staged files only..."

# Prettier check (only on staged files)
echo "  - Prettier (staged files)..."
echo "$STAGED_FILES" | xargs npx prettier --check --ignore-unknown || {
  echo ""
  echo "Prettier formatting issues found in staged files."
  echo "Run: npm run format"
  echo "(or format just the staged files manually)"
  exit 1
}

# ESLint (only on staged files)
echo "  - ESLint (staged files)..."
echo "$STAGED_FILES" | xargs npx eslint --max-warnings=999 || {
  echo ""
  echo "ESLint issues found in staged files."
  echo "Fix the errors/warnings above before committing."
  exit 1
}

# TypeScript checks are project-wide (a change in one file can break types elsewhere)
echo "  - TypeScript (root)..."
npx tsc --noEmit --skipLibCheck || {
  echo "TypeScript errors found (root project)."
  exit 1
}

echo "  - TypeScript (dashboard)..."
(cd dashboard && npx tsc --noEmit --skipLibCheck) || {
  echo "TypeScript errors found (dashboard)."
  exit 1
}

echo "✅ Pre-commit checks passed."
echo ""
echo "Reminder: Run 'npm run pre-pr' before opening a PR."

exit 0