#!/usr/bin/env bash
#
# scripts/refresh-workflow-kits.sh
#
# Maintainer helper: Regenerates the portable workflow kits (generic + node-fullstack)
# and drops fresh copies into the parent /projects directory for easy sibling adoption.
#
# Usage:
#   bash scripts/refresh-workflow-kits.sh
#   bash scripts/refresh-workflow-kits.sh --with-tag
#
# This should be run whenever the workflow system is meaningfully improved.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARENT_DIR="$(dirname "$REPO_ROOT")"

echo "==> Refreshing Portable Workflow Kits for sibling projects"
echo "    Source repo : $REPO_ROOT"
echo "    Drop target : $PARENT_DIR"

cd "$REPO_ROOT"

# Generate generic latest
echo ""
echo ">>> Generating generic kit..."
npm run generate-kit -- --zip --output dist/portable-workflow-kit

cp dist/portable-workflow-kit-*.zip "$PARENT_DIR/" 2>/dev/null || true
rm -rf "$PARENT_DIR/portable-workflow-kit-latest"
cp -r dist/portable-workflow-kit "$PARENT_DIR/portable-workflow-kit-latest"

echo "    ✓ Generic kit updated at $PARENT_DIR/portable-workflow-kit-latest"

# Generate node-fullstack (SaaS) specialized
echo ""
echo ">>> Generating node-fullstack (SaaS) specialized kit..."
npm run generate-kit -- --project-type node-fullstack --zip --output dist/portable-workflow-kit-saas

cp dist/portable-workflow-kit-saas-*.zip "$PARENT_DIR/" 2>/dev/null || true
rm -rf "$PARENT_DIR/portable-workflow-kit-node-fullstack-latest"
cp -r dist/portable-workflow-kit-saas "$PARENT_DIR/portable-workflow-kit-node-fullstack-latest"

echo "    ✓ SaaS (node-fullstack) kit updated at $PARENT_DIR/portable-workflow-kit-node-fullstack-latest"

echo ""
echo "✅ Kits refreshed successfully."
echo ""
echo "Sibling projects can now use:"
echo "  - ../portable-workflow-kit-latest/"
echo "  - ../portable-workflow-kit-node-fullstack-latest/"
echo ""
echo "Tip: Commit the changes to the dated zips if you want a permanent record."
