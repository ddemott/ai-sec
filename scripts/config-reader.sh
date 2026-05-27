#!/usr/bin/env bash
#
# scripts/config-reader.sh
#
# Tiny, zero-dependency (beyond python3) helper to read values from workflow.config.json.
# Used by prepare-commit.sh, the example hooks, and create-feature-branch.sh so they
# automatically respect the declared projectType and the exact command strings.
#
# See portable-workflow-kit/scripts/config-reader.sh for the authoritative copy + docs.

set -euo pipefail

CONFIG_FILE="${WORKFLOW_CONFIG_FILE:-workflow.config.json}"

find_config() {
    local dir="$PWD"
    while [ "$dir" != "/" ]; do
        if [ -f "$dir/$CONFIG_FILE" ]; then
            echo "$dir/$CONFIG_FILE"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "$script_dir/../$CONFIG_FILE" ]; then
        echo "$script_dir/../$CONFIG_FILE"
        return 0
    fi
    echo ""
}

CONFIG_PATH="$(find_config)"

_get_json_string() {
    local key="$1"
    if [ -z "$CONFIG_PATH" ] || [ ! -f "$CONFIG_PATH" ]; then
        echo ""
        return 0
    fi

    if command -v jq >/dev/null 2>&1; then
        jq -r --arg k "$key" '.[$k] // empty' "$CONFIG_PATH" 2>/dev/null || echo ""
        return 0
    fi

    python3 - "$CONFIG_PATH" "$key" 2>/dev/null <<'PY' || echo ""
import json, sys
path, key = sys.argv[1], sys.argv[2]
try:
    with open(path) as f:
        data = json.load(f)
    val = data.get(key, "")
    if isinstance(val, (dict, list)):
        val = ""
    print(val if val is not None else "")
except Exception:
    print("")
PY
}

get_project_type() {
    local t
    t="$(_get_json_string "projectType")"
    if [ -z "$t" ]; then
        echo "node-fullstack"
    else
        echo "$t"
    fi
}

get_command() {
    local key="$1"
    local cmd
    if command -v jq >/dev/null 2>&1 && [ -f "$CONFIG_PATH" ]; then
        cmd=$(jq -r --arg k "$key" '.commands[$k] // empty' "$CONFIG_PATH" 2>/dev/null || true)
    else
        cmd=$(python3 - "$CONFIG_PATH" "$key" 2>/dev/null <<'PY' || true
import json, sys
path, key = sys.argv[1], sys.argv[2]
try:
    with open(path) as f:
        data = json.load(f)
    cmds = data.get("commands", {}) or {}
    val = cmds.get(key, "")
    print(val if val is not None else "")
except Exception:
    print("")
PY
)
    fi

    if [ -n "$cmd" ]; then
        echo "$cmd"
        return 0
    fi

    _get_json_string "$key"
}

is_real_command() {
    local cmd="$1"
    if [ -z "$cmd" ]; then return 1; fi
    if echo "$cmd" | grep -qiE '^(echo |true|false|:)'; then
        return 1
    fi
    return 0
}

export CONFIG_PATH
export -f get_project_type
export -f get_command
export -f is_real_command
