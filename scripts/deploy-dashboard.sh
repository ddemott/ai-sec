#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../dashboard"
railway up --detach
