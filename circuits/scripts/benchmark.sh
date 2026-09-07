#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD=build
RESULTS="$BUILD/benchmark-results.json"
mkdir -p "$BUILD"

DEPTHS=${@:-"8 16 20"}

OUTS=()
for d in $DEPTHS; do
  echo "\n=== Benchmarking levels=$d ==="
  LEVELS=$d npm run compile
  LEVELS=$d npm run setup

  R1CS="$BUILD/membership.r1cs"
  ZKEY="$BUILD/membership_final.zkey"
  WASM="$BUILD/membership_js/membership.wasm"

  # File sizes (bytes)
  if [ -f "$R1CS" ]; then
    r1cs_size=$(stat -c%s "$R1CS" 2>/dev/null || stat -f%z "$R1CS" 2>/dev/null || echo 0)
  else
    r1cs_size=0
  fi
  if [ -f "$ZKEY" ]; then
    zkey_size=$(stat -c%s "$ZKEY" 2>/dev/null || stat -f%z "$ZKEY" 2>/dev/null || echo 0)
  else
    zkey_size=0
  fi
  if [ -f "$WASM" ]; then
    wasm_size=$(stat -c%s "$WASM" 2>/dev/null || stat -f%z "$WASM" 2>/dev/null || echo 0)
  else
    wasm_size=0
  fi

  # Constraint count (snarkjs may print info differently across versions)
  constraints=null
  if command -v npx >/dev/null 2>&1; then
    info=$(npx --yes snarkjs r1cs info "$R1CS" 2>/dev/null || true)
    # Try to extract a number from the output
    if [[ $info =~ ([0-9]+) ]]; then
      constraints=${BASH_REMATCH[1]}
    fi
  fi

  # Browser proving time and claim CPU must be measured separately and
  # filled in by the operator running this script (placeholders for now).
  browser_ms=null
  claim_cpu=null

  OUTS+=("{\"levels\":$d,\"r1cs_size\":$r1cs_size,\"zkey_size\":$zkey_size,\"wasm_size\":$wasm_size,\"constraints\":${constraints},\"browser_ms\":$browser_ms,\"claim_cpu\":$claim_cpu}")
done

printf "%s\n" "[${OUTS[*]}]" > "$RESULTS"
echo "Wrote $RESULTS"
