#!/usr/bin/env bash
set -euo pipefail

# 1. Check for accidentally staged Stellar secret keys
node scripts/maintenance/check-secrets.mjs

# 2. Check formatting
npm run format:check
