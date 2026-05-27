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
#   ./scripts/generate-portable-kit.sh --project-type python --zip   # ready-to-hand to a Python team
#   ./scripts/generate-portable-kit.sh --project-type node-fullstack --tag --bump patch
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
PROJECT_TYPE=""

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
        --project-type)
            PROJECT_TYPE="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--zip] [--tag] [--bump <patch|minor|major>] [--tag-prefix <prefix>] [--output <path>] [--project-type <node-fullstack|python|generic>]"
            echo ""
            echo "  --zip            Create a zip archive of the kit"
            echo "  --tag            Create a git tag"
            echo "  --bump           Bump version in workflow.config.json before tagging (patch|minor|major)"
            echo "  --tag-prefix     Custom prefix for the git tag (default: workflow-kit/v)"
            echo "  --output         Custom output directory"
            echo "  --project-type   Pre-populate the kit for a specific project type (node-fullstack | python | generic). Makes the generated kit immediately usable for non-Node projects without irrelevant lint commands."
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

# --- Project-type specialization (the key enabler for easy transfer to Python etc.) ---
if [ -n "$PROJECT_TYPE" ]; then
    echo "==> Specializing kit for projectType: $PROJECT_TYPE"

    KIT_CONFIG="$OUTPUT_DIR/workflow.config.json"

    # Use python (nearly universal) to safely rewrite the emitted config:
    # - Set top-level "projectType"
    # - Copy the chosen profile's commands into the active "commands" block
    python3 - "$KIT_CONFIG" "$PROJECT_TYPE" <<'PYEOF'
import json, sys
cfg_path, ptype = sys.argv[1], sys.argv[2]

with open(cfg_path) as f:
    cfg = json.load(f)

profiles = cfg.get("projectTypeProfiles", {})
if ptype not in profiles:
    print(f"WARNING: Unknown projectType '{ptype}'. Valid: {list(profiles.keys())}. Leaving config generic.", file=sys.stderr)
    ptype = "generic"

cfg["projectType"] = ptype

# Replace the active commands with the chosen profile (deep copy of values)
profile = profiles.get(ptype, {})
if "commands" not in cfg:
    cfg["commands"] = {}
for k, v in profile.items():
    if k != "notes":
        cfg["commands"][k] = v

# Also update the human-facing notes in documentation section if present
if "documentation" in cfg and "notes" not in cfg["documentation"]:
    cfg["documentation"]["notes"] = f"Pre-populated for projectType '{ptype}'. Review and tweak the 'commands' values."

with open(cfg_path, "w") as f:
    json.dump(cfg, f, indent=2)

print(f"    ✓ workflow.config.json specialized for {ptype} (commands block populated from profile)")
PYEOF

    # Light touch-ups to the emitted kit README so the recipient sees the type immediately
    sed -i "s|for your tooling and standards|for a **${PROJECT_TYPE}** project (customize commands in workflow.config.json)|" "$OUTPUT_DIR/README.md" 2>/dev/null || true

    echo "    ✓ Kit README and config adapted for ${PROJECT_TYPE}"
fi

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
echo "They should:"
echo "  1. Read ADOPTING_THE_WORKFLOW.md"
echo "  2. Verify (or tweak) the projectType + commands in workflow.config.json"
echo "  3. Run the setup steps"
echo ""
if [ -n "$PROJECT_TYPE" ]; then
    echo "This kit was pre-specialized for projectType='${PROJECT_TYPE}'."
    echo "The automation scripts will now only run the relevant commands for that type (no blind eslint on Python, etc.)."
fi
echo ""
if [ "$CREATE_TAG" = false ]; then
    echo "Tip: Use --tag to create a git tag, and --bump patch|minor|major to auto-increment the version."
    echo "Tip: Use --project-type python|node-fullstack|generic when generating for a non-SaaS recipient."
fi