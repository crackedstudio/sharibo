#!/usr/bin/env bash
# Opt-in pre-commit hook installer.
#
# Symlinks scripts/maintenance/check-secrets.mjs into .git/hooks/pre-commit so
# that every `git commit` scans staged files for accidentally-included Stellar
# secret keys (S...).
#
# Usage:
#   bash scripts/maintenance/install-hooks.sh
#
# To uninstall:
#   rm .git/hooks/pre-commit

set -euo pipefail

HOOK_SRC="$(cd "$(dirname "$0")" && pwd)/check-secrets.mjs"
HOOK_DST="$(git rev-parse --git-dir)/hooks/pre-commit"

if [ ! -f "$HOOK_SRC" ]; then
  echo "Error: $HOOK_SRC not found. Run this script from the repo root."
  exit 1
fi

if [ -e "$HOOK_DST" ] && [ ! -L "$HOOK_DST" ]; then
  echo "Warning: $HOOK_DST already exists and is not a symlink."
  echo "  Backing it up to ${HOOK_DST}.bak"
  mv "$HOOK_DST" "${HOOK_DST}.bak"
fi

ln -sf "$HOOK_SRC" "$HOOK_DST"
chmod +x "$HOOK_DST"

echo "Installed pre-commit hook: $HOOK_DST -> $HOOK_SRC"
echo "The hook will check for Stellar secret keys on every commit."
