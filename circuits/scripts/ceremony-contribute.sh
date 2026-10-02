#!/usr/bin/env bash
# One Groth16 phase-2 contribution step for a multi-party ceremony (#546).
# Wraps `snarkjs zkey contribute` and prints the contribution hash for
# independent attestation (see docs/ceremony.md).
#
# Usage:
#   ./scripts/ceremony-contribute.sh INPUT.zkey OUTPUT.zkey "Contributor name"
#
# Entropy: reads 64 bytes from /dev/urandom (override with CONTRIBUTION_ENTROPY
# env var set to a base64 string if your runbook requires a different source).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "$#" -lt 3 ]; then
  echo "Usage: $0 INPUT.zkey OUTPUT.zkey \"Contributor name\"" >&2
  exit 1
fi

INPUT_ZKEY="$1"
OUTPUT_ZKEY="$2"
CONTRIBUTOR_NAME="$3"

if [ ! -f "$INPUT_ZKEY" ]; then
  echo "Input zkey not found: $INPUT_ZKEY" >&2
  exit 1
fi

ENTROPY="${CONTRIBUTION_ENTROPY:-$(head -c 64 /dev/urandom | base64)}"

echo "Contributing to phase-2 zkey..."
echo "  input:  $INPUT_ZKEY"
echo "  output: $OUTPUT_ZKEY"
echo "  name:   $CONTRIBUTOR_NAME"
echo ""

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

if ! npx --yes snarkjs zkey contribute "$INPUT_ZKEY" "$OUTPUT_ZKEY" \
  --name="$CONTRIBUTOR_NAME" -v -e="$ENTROPY" 2>&1 | tee "$LOG"; then
  echo "snarkjs zkey contribute failed" >&2
  exit 1
fi

echo ""
echo "── Attestation ─────────────────────────────────────────────"
if grep -iE 'contribution hash|contributions hash' "$LOG" >/dev/null 2>&1; then
  grep -iE 'contribution hash|contributions hash' "$LOG" || true
else
  echo "(snarkjs did not print a line matching 'contribution hash' — paste the full log above into your attestation.)"
fi

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "sha256-unavailable"
  fi
}

echo "Output zkey SHA-256: $(hash_file "$OUTPUT_ZKEY")"
echo "Publish the contribution hash and this file hash per docs/ceremony.md"
