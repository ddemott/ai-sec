#!/usr/bin/env bash
# Encrypts a secret value and stores it in the Claude memory directory.
# Usage: bash scripts/store-secret.sh [--name <slug>]
# Example: bash scripts/store-secret.sh --name db_url

set -euo pipefail

MEMORY_DIR="/home/dale/.claude/projects/-home-dale-projects-secretary-hq/memory"
NAME="${1:-}"

# Parse --name flag
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ -z "$NAME" ]]; then
  read -rp "Secret name (slug, e.g. db_url): " NAME
fi

read -rp "Paste secret value: " SECRET_VALUE
echo
read -rsp "Encryption password: " PASSWORD
echo
read -rsp "Confirm password: " PASSWORD2
echo

if [[ "$PASSWORD" != "$PASSWORD2" ]]; then
  echo "ERROR: passwords do not match" >&2
  exit 1
fi

OUTFILE="$MEMORY_DIR/${NAME}.enc"
printf '%s' "$SECRET_VALUE" | openssl enc -aes-256-cbc -pbkdf2 -base64 -pass pass:"$PASSWORD" > "$OUTFILE"

echo "Stored: $OUTFILE"
echo "Decrypt with: openssl enc -d -aes-256-cbc -pbkdf2 -base64 -pass pass:PASSWORD -in $OUTFILE"
