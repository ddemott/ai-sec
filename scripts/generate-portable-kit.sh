#!/usr/bin/env bash
#
# scripts/generate-portable-kit.sh
#
# Generates a clean, distributable copy of the Portable Development Workflow Kit.
#
# This is the recommended way to export the latest version of the kit
# for use in other projects.
#
# Usage:
#   ./scripts/generate-portable-kit.sh
#   ./scripts/generate-portable-kit.sh --zip
#   ./scripts/generate-portable-kit.sh --tag --bump patch
#   ./scripts/generate-portable-kit.sh --zip --tag --bump minor --tag-prefix "my-workflow/v"
#   ./scripts/generate-portable-kit.sh --output ./my-export
#
# Output:
#   By default creates: dist/portable-workflow-kit/
#   With --zip also creates: dist/portable-workflow-kit-<date>.zip
#   With --tag also creates a git tag (e.g. workflow-kit/v1.0.1)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KIT_SOURCE="$REPO_ROOT/portable-workflow-kit"
OUTPUT_DIR="$REPO_ROOT/dist/portable-workflow-kit"
CREATE_ZIP=false
CUSTOM_OUTPUT=""
CREATE_TAG=false
BUMP_TYPE=""
TAG_PREFIX="workflow-kit/v"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --zip)
            CREATE_ZIP=true
            shift
            ;;
        --output)
            CUSTOM_OUTPUT="$2"
            shift 2
            ;;
        --tag)
            CREATE_TAG=true
            shift
            ;;
        --bump)
            BUMP_TYPE="${2:-patch}"
            shift 2
            ;;
        --tag-prefix)
            TAG_PREFIX="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--zip] [--tag] [--bump <patch|minor|major>] [--tag-prefix <prefix>] [--output <path>]"
            echo ""
            echo "  --zip          Create a zip archive of the kit"
            echo "  --tag          Create a git tag"
            echo "  --bump         Bump version in workflow.config.json before tagging (patch|minor|major)"
            echo "  --tag-prefix   Custom prefix for the git tag (default: workflow-kit/v)"
            echo "  --output       Custom output directory"
            exit 1
            ;;
    esac
done

if [ -n "$CUSTOM_OUTPUT" ]; then
    OUTPUT_DIR="$CUSTOM_OUTPUT"
fi

DATE=$(date +%Y-%m-%d)
ZIP_NAME="portable-workflow-kit-${DATE}.zip"

# Read version from the source workflow.config.json
KIT_VERSION=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[0-9.]*"' "$KIT_SOURCE/workflow.config.json" | head -1 | sed 's/.*"\([0-9.]*\)"/\1/') || "1.0.0"

# Function to bump semantic version
bump_version() {
    local version=$1
    local type=${2:-patch}

    IFS='.' read -ra parts <<< "$version"
    major=${parts[0]:-0}
    minor=${parts[1]:-0}
    patch=${parts[2]:-0}

    case $type in
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        patch|*)
            patch=$((patch + 1))
            ;;
    esac

    echo "${major}.${minor}.${patch}"
}

# Handle version bumping if requested
if [ "$CREATE_TAG" = true ] && [ -n "$BUMP_TYPE" ]; then
    OLD_VERSION="$KIT_VERSION"
    KIT_VERSION=$(bump_version "$KIT_VERSION" "$BUMP_TYPE")

    # Update the version in the source workflow.config.json
    sed -i "s/\"version\"[[:space:]]*:[[:space:]]*\"${OLD_VERSION}\"/\"version\": \"${KIT_VERSION}\"/" "$KIT_SOURCE/workflow.config.json"

    echo "    ✓ Bumped version from ${OLD_VERSION} → ${KIT_VERSION} in workflow.config.json"
fi

echo "==> Generating Portable Development Workflow Kit"
echo "    Source: $KIT_SOURCE"
echo "    Destination: $OUTPUT_DIR"

# Clean previous output
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# Copy all files while preserving structure
cp -r "$KIT_SOURCE"/* "$OUTPUT_DIR/"

# Inject version information into the generated kit
if [ -n "$KIT_VERSION" ]; then
    # Add version to the kit's README
    sed -i "1s/.*/# Portable Development Workflow Kit v${KIT_VERSION}/" "$OUTPUT_DIR/README.md" 2>/dev/null || \
    echo "# Portable Development Workflow Kit v${KIT_VERSION}" > "$OUTPUT_DIR/README.md.tmp" && cat "$OUTPUT_DIR/README.md" >> "$OUTPUT_DIR/README.md.tmp" && mv "$OUTPUT_DIR/README.md.tmp" "$OUTPUT_DIR/README.md"

    # Create a VERSION file for easy consumption
    echo "$KIT_VERSION" > "$OUTPUT_DIR/VERSION"
    echo "    ✓ Version ${KIT_VERSION} injected (README + VERSION file)"
fi

echo "    ✓ Files copied"

# Optional: Create a zip archive
if [ "$CREATE_ZIP" = true ]; then
    ZIP_PATH="$REPO_ROOT/dist/$ZIP_NAME"
    (cd "$(dirname "$OUTPUT_DIR")" && zip -r "$ZIP_PATH" "$(basename "$OUTPUT_DIR")" -q)
    echo "    ✓ Zip archive created: dist/$ZIP_NAME"
fi

echo ""
echo "✅ Kit generated successfully!"
echo ""

# Optional: Create a git tag for this kit release
if [ "$CREATE_TAG" = true ]; then
    if [ -n "$KIT_VERSION" ]; then
        TAG_NAME="${TAG_PREFIX}${KIT_VERSION}"
        if git tag -l | grep -q "^${TAG_NAME}$"; then
            echo "⚠️  Tag ${TAG_NAME} already exists. Skipping tag creation."
        else
            git tag "$TAG_NAME"
            echo "    ✓ Created git tag: ${TAG_NAME}"
        fi
    else
        echo "⚠️  Could not determine version for tagging."
    fi
fi

echo ""
echo "To share with another project, give them:"
echo "  - The contents of: $OUTPUT_DIR"
echo "  - Or point them to: ADOPTING_THE_WORKFLOW.md"
echo ""
echo "They should read ADOPTING_THE_WORKFLOW.md and customize workflow.config.json."
echo ""
if [ "$CREATE_TAG" = false ]; then
    echo "Tip: Use --tag to create a git tag, and --bump patch|minor|major to auto-increment the version."
fi