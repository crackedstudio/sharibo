#!/usr/bin/env bash
# Standalone setup verification (issue #271) — does NOT regenerate anything.
#
# Guarantees: the final zkey is self-consistent with the r1cs + powers-of-tau,
# and exporting it reproduces the committed verification_key.json exactly.
# Threat addressed: a corrupt/substituted zkey, or a silent ceremony re-run
# that rotated the on-disk proving key without updating the committed vk.
#
# Exit codes:
#   0  — setup verified
#  30  — required artifact missing
#  31  — snarkjs zkey verify failed
#  32  — exported vk differs from committed verification_key.json
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

EXIT_OK=0
EXIT_MISSING=30
EXIT_ZKEY=31
EXIT_VK=32

for artifact in "$R1CS" "$PTAU_FINAL" "$ZKEY"; do
  if [ ! -f "$artifact" ]; then
    echo "missing $artifact — run \`npm run compile && npm run setup\` first" >&2
    exit "$EXIT_MISSING"
  fi
done
if [ ! -f "$COMMITTED_VK" ]; then
  echo "missing committed $COMMITTED_VK" >&2
  exit "$EXIT_MISSING"
fi

FOUND_ZKEY_FAILURE=0
FOUND_VK_FAILURE=0

echo "1) Checking $ZKEY against the r1cs and powers-of-tau..."
if ! npx --yes snarkjs zkey verify "$R1CS" "$PTAU_FINAL" "$ZKEY"; then
  echo "✗ zkey verify failed — the final key is corrupt or was built from a" >&2
  echo "  different circuit/powers-of-tau. Re-run \`npm run compile && npm run setup\`." >&2
  FOUND_ZKEY_FAILURE=1
fi

echo "2) Checking exported verification key matches committed $COMMITTED_VK..."
TMP_VK="$BUILD/.verification_key.verify-setup.json"
rm -f "$TMP_VK"
npx --yes snarkjs zkey export verificationkey "$ZKEY" "$TMP_VK"
if ! cmp -s "$TMP_VK" "$COMMITTED_VK"; then
  echo "✗ exported verification key differs from committed $COMMITTED_VK." >&2
  echo "  This is a key rotation — either commit the new key deliberately after" >&2
  echo "  re-running \`npm run setup\`, or restore the committed key." >&2
  FOUND_VK_FAILURE=1
fi
rm -f "$TMP_VK"

if [ "$FOUND_ZKEY_FAILURE" -ne 0 ]; then
  echo "" >&2
  echo "setup verification FAILED (zkey inconsistent)." >&2
  exit "$EXIT_ZKEY"
fi

if [ "$FOUND_VK_FAILURE" -ne 0 ]; then
  echo "" >&2
  echo "setup verification FAILED (verification key mismatch)." >&2
  exit "$EXIT_VK"
fi

echo "✓ Setup verified: zkey is valid and matches the committed verification key."
exit "$EXIT_OK"
