#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v circom &>/dev/null; then
  echo "circom not found. Install circom 2.1.6+ from https://docs.circom.io/getting-started/installation/" >&2
  exit 1
fi

version=$(circom --version 2>/dev/null | grep -oP '[\d]+\.[\d]+\.[\d]+' | head -1)
if [[ -z "$version" ]]; then
  echo "Could not parse circom version. Install circom 2.1.6+ from https://docs.circom.io/getting-started/installation/" >&2
  exit 1
fi

if ! printf '%s\n' "2.1.6" "$version" | sort -V | head -1 | grep -q '^2.1.6$'; then
  echo "circom $version detected; need >= 2.1.6. Upgrade from https://docs.circom.io/getting-started/installation/" >&2
  exit 1
fi

# Regenerate membership.circom from membership.template.circom + config.json
# Allow overriding the levels with the LEVELS env var, e.g.:
#
#   LEVELS=8 npm run compile
#
echo "Generating membership.circom (LEVELS=${LEVELS:-from config.json})"
node scripts/gen-circuit.cjs

mkdir -p build
circom membership.circom --r1cs --wasm --sym --prime bls12381 -l ../node_modules -o build

echo "Compiled -> build/membership.r1cs, build/membership_js/membership.wasm"
