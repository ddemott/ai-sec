#!/usr/bin/env bash
#
# scripts/example-pre-push-hook.sh
#
# Example pre-push hook.
# This runs BEFORE `git push` is allowed.
#
# Called automatically via .husky/pre-push (managed by Husky).
#
# It is intentionally stricter than the pre-commit hook.
# Recommended checks before pushing to a remote:
#   - Full lint + format + typecheck
#   - Relevant unit tests
#
# Heavy E2E can still be run selectively via the developer.

set -euo pipefail

echo "==> Running pre-push checks..."

echo "  - Running quality checks (checks)..."
npm run checks || {
  echo ""
  echo "Pre-push checks failed."
  echo "Fix the issues above before pushing."
  exit 1
}

echo "  - Running unit tests..."
npm test || {
  echo ""
  echo "Some unit tests are failing."
  echo "Please fix them before pushing."
  exit 1
}

echo "✅ Pre-push checks passed."
echo ""
echo "Reminder: Consider running relevant E2E tests before opening a PR:"
echo "  cd dashboard && npx playwright test --grep \"<your-pattern>\""
echo ""

exit 0