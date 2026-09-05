#!/usr/bin/env bash
# Standalone setup verification (issue #271) — does NOT regenerate anything.
#
# Proves the two invariants that make a local setup run trustable:
#   1. build/membership_final.zkey is self-consistent with the r1cs and the
#      powers-of-tau file used to produce it (`snarkjs zkey verify`).
#   2. Exporting that zkey reproduces the committed circuits/verification_key.json
#      exactly, so no silent regeneration has replaced the canonical key.
#
# Unlike setup.sh, this script has no rotation escape hatch: it is a pure
# check and fails hard on either violation. Run it from the circuits/ dir:
#
#   npm run verify-setup
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD=build
CURVE=bls12381
PTAU_POWER=12
PTAU_FINAL="$BUILD/pot${PTAU_POWER}_${CURVE}_final.ptau"
R1CS="$BUILD/membership.r1cs"
ZKEY="$BUILD/membership_final.zkey"
COMMITTED_VK="verification_key.json"

for artifact in "$R1CS" "$PTAU_FINAL" "$ZKEY"; do
  if [ ! -f "$artifact" ]; then
    echo "missing $artifact — run \`npm run compile && npm run setup\` first" >&2
    exit 1
  fi
done
if [ ! -f "$COMMITTED_VK" ]; then
  echo "missing committed $COMMITTED_VK" >&2
  exit 1
fi

FOUND_FAILURE=0

echo "1) Checking $ZKEY against the r1cs and powers-of-tau..."
if ! npx --yes snarkjs zkey verify "$R1CS" "$PTAU_FINAL" "$ZKEY"; then
  echo "✗ zkey verify failed — the final key is corrupt or was built from a" >&2
  echo "  different circuit/powers-of-tau. Re-run \`npm run compile && npm run setup\`." >&2
  FOUND_FAILURE=1
fi

echo "2) Checking exported verification key matches committed $COMMITTED_VK..."
TMP_VK="$BUILD/.verification_key.verify-setup.json"
rm -f "$TMP_VK"
npx --yes snarkjs zkey export verificationkey "$ZKEY" "$TMP_VK"
if ! cmp -s "$TMP_VK" "$COMMITTED_VK"; then
  echo "✗ exported verification key differs from committed $COMMITTED_VK." >&2
  echo "  This is a key rotation — either commit the new key deliberately after" >&2
  echo "  re-running \`npm run setup\`, or restore the committed key." >&2
  FOUND_FAILURE=1
fi
rm -f "$TMP_VK"

if [ "$FOUND_FAILURE" -ne 0 ]; then
  echo "" >&2
  echo "setup verification FAILED." >&2
  exit 1
fi

echo "✓ Setup verified: zkey is valid and matches the committed verification key."