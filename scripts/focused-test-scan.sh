#!/usr/bin/env bash
#
# scripts/focused-test-scan.sh
#
# Prints any test that is FOCUSED or PERMANENTLY DISABLED. Silence = clean.
# Called by prepare-commit.sh via workflow.config.json ("focusedTestScan").
#
# What counts as a problem:
#   .only(                     — focused test; would silently skip the rest of the file in CI
#   .skip('name', ...)         — a test declaration disabled by name, i.e. dead
#   .todo('name')              — likewise
#
# What does NOT count (and is why this lives in a script rather than a grep
# inlined in the JSON config): a *conditional* skip is a legitimate, widely
# used pattern here, and the previous inlined regex `(\.only\(|\.skip\()`
# matched all of them. That made `npm run prepare-commit` report a failure on
# a pristine main regardless of code state, training everyone to ignore it.
# Conditional forms deliberately allowed:
#   test.skip(process.env.FOO !== '1', 'requires FOO=1')   — env-gated
#   test.skip();  ctx.skip();  testInfo.skip(...)          — runtime, inside an if
#
# The discriminator: a skip whose FIRST argument is a string literal is naming
# a test (dead code). A skip whose first argument is an expression is a guard.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# [[:space:]]* then a single- or double-quote => first arg is a string literal.
PATTERN='\.only\(|\.(skip|todo)\([[:space:]]*["'"'"']'

grep -rn \
    --include="*.test.*" \
    --include="*.spec.*" \
    --exclude-dir=node_modules \
    -E "$PATTERN" \
    src/ dashboard/ 2>/dev/null || true
