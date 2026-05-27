#!/usr/bin/env bash
#
# scripts/prepare-commit.sh
#
# Runs as much of the pre-commit / pre-PR checklist as can be automated.
# This is the main automation command for preparing work to be committed.
#
# Usage:
#   npm run prepare-commit
#
# It will:
#   - Run format + lint + typecheck (checks)
#   - Run full unit test suite
#   - Run the CLAUDE.md drift detector
#   - Check for .only / .skip in test files
#   - Check for common issues in staged changes
#   - Print a clear list of remaining manual steps

set -euo pipefail

echo "=========================================="
echo "  PREPARING FOR COMMIT / PR"
echo "  (Automated portion of the workflow)"
echo "=========================================="
echo ""

FAILED=0

echo ">>> 1. Running quality checks (format + lint + typecheck)..."
if npm run checks; then
  echo "    ✅ Quality checks passed"
else
  echo "    ❌ Quality checks failed"
  FAILED=1
fi
echo ""

echo ">>> 2. Running unit tests..."
if npm test; then
  echo "    ✅ Unit tests passed"
else
  echo "    ❌ Some unit tests failed"
  FAILED=1
fi
echo ""

echo ">>> 3. Running CLAUDE.md drift detector..."
if npm run verify:claude-md; then
  echo "    ✅ CLAUDE.md is up to date"
else
  echo "    ❌ CLAUDE.md drift detected"
  FAILED=1
fi
echo ""

echo ">>> 4. Checking for focused tests (.only / .skip)..."
if grep -r --include="*.test.*" --include="*.spec.*" -E "(\.only\(|\.skip\()" src/ dashboard/ --exclude-dir=node_modules 2>/dev/null; then
  echo "    ❌ Found .only or .skip in test files"
  FAILED=1
else
  echo "    ✅ No focused tests found"
fi
echo ""

echo ">>> 5. Checking staged files for common issues..."
STAGED=$(git diff --cached --name-only || true)
if [ -n "$STAGED" ]; then
  # Check for console.log in staged JS/TS (simple heuristic)
  if echo "$STAGED" | xargs grep -l "console\.(log|debug)" 2>/dev/null | head -5; then
    echo "    ⚠️  Found console.log/debug in staged files (review before committing)"
  fi
else
  echo "    (No files staged yet — this check is more useful after 'git add')"
fi
echo ""

echo "=========================================="
if [ "$FAILED" -eq 0 ]; then
  echo "✅ Automated checks completed successfully."
else
  echo "❌ Some automated checks failed. Please fix the issues above."
fi
echo "=========================================="
echo ""

echo "Remaining manual / human steps before using 'commit' with your agent:"
echo ""
echo "  - Review and fix any failures from the checks above"
echo "  - Run relevant E2E tests (use --grep for speed):"
echo "      cd dashboard && npx playwright test --grep \"<pattern>\""
echo "  - Update documentation (CLAUDE.md, TODO.md, RESOLVED.md, etc.)"
echo "  - Fill out BRANCH_CHECKLIST.md"
echo "  - Write a good commit message (the commit-code skill will help draft one)"
echo "  - Get explicit approval from the commit-code process before committing"
echo ""

echo "When ready, tell your agent:"
echo "  \"commit\" or \"commit code\""
echo ""

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi