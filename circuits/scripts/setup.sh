#!/usr/bin/env bash
# Powers-of-Tau (bls12381) + Groth16 trusted setup for the Sharibo circuit,
# with integrity verification of the produced key material.
#
# This is a hackathon-demo trusted setup: single contributor, random entropy
# from /dev/urandom. Real deployments would run a multi-party ceremony. See
# README "Honest limitations".
#
# Usage:
#
#   npm run setup              Ceremony + verification. Idempotent: if
#                              build/membership_final.zkey already exists the
#                              ceremony is skipped and verification runs in
#                              place (matches `verify-setup`).
#   npm run verify-setup       Fast gate with no ceremony: runs `snarkjs zkey
#                              verify` and the verification-key drift check
#                              against the committed verification_key.json.
#   npm run setup:rotate       Full ceremony + intentionally install a NEW
#                              verification key (only if you mean to rotate —
#                              see README "Setup verification").
#
# Every run ends with two checks:
#
#   1. `snarkjs zkey verify <r1cs> <ptau> <zkey>` — detects a corrupted or
#      mismatched final key. A non-zero exit aborts the script.
#   2. A diff of the exported verification key against the committed
#      `verification_key.json`. A mismatch means a silent regeneration / key
#      rotation; it aborts loudly unless `--rotate` was given, because every
#      on-chain circle stores the key it was created with and would stop
#      accepting proofs generated under a new key.
#
# After a successful ceremony run this script appends a fingerprint entry to
# circuits/SETUP_TRANSCRIPT.md so the canonical artifacts are always
# traceable.
set -euo pipefail
cd "$(dirname "$0")/.."

BUILD=build
CURVE=bls12381
PTAU_POWER=12
PTAU_FINAL="$BUILD/pot${PTAU_POWER}_${CURVE}_final.ptau"
R1CS="$BUILD/membership.r1cs"
ZKEY_FINAL="$BUILD/membership_final.zkey"
VK="verification_key.json"
VK_CANDIDATE="$BUILD/verification_key.candidate.json"
TRANSCRIPT="SETUP_TRANSCRIPT.md"

VERIFY_ONLY=0
ALLOW_ROTATION=0
for arg in "$@"; do
  case "$arg" in
    --verify-only) VERIFY_ONLY=1 ;;
    --rotate) ALLOW_ROTATION=1 ;;
    *)
      echo "usage: scripts/setup.sh [--verify-only] [--rotate]" >&2
      exit 2
      ;;
  esac
done

if [ "$VERIFY_ONLY" = "1" ] && [ "$ALLOW_ROTATION" = "1" ]; then
  echo "--verify-only cannot be combined with --rotate (verification never writes files)" >&2
  exit 2
fi

mkdir -p "$BUILD"

# ── Ceremony (only on a fresh build; otherwise verify in place) ──────────────
NEW_KEY=0
if [ "$VERIFY_ONLY" = "0" ] && [ ! -f "$ZKEY_FINAL" ]; then
  if [ ! -f "$R1CS" ]; then
    echo "membership.r1cs not found — run scripts/compile.sh first" >&2
    exit 1
  fi

  if [ ! -f "$PTAU_FINAL" ]; then
    npx --yes snarkjs powersoftau new "$CURVE" "$PTAU_POWER" "$BUILD/pot${PTAU_POWER}_${CURVE}_0000.ptau" -v
    npx --yes snarkjs powersoftau contribute "$BUILD/pot${PTAU_POWER}_${CURVE}_0000.ptau" "$BUILD/pot${PTAU_POWER}_${CURVE}_0001.ptau" \
      --name="Sharibo phase1 contribution" -v -e="$(head -c 64 /dev/urandom | base64)"
    npx --yes snarkjs powersoftau prepare phase2 "$BUILD/pot${PTAU_POWER}_${CURVE}_0001.ptau" "$PTAU_FINAL" -v
  fi

  npx --yes snarkjs groth16 setup "$R1CS" "$PTAU_FINAL" "$BUILD/membership_0000.zkey"
  npx --yes snarkjs zkey contribute "$BUILD/membership_0000.zkey" "$ZKEY_FINAL" \
    --name="Sharibo circuit key contribution" -v -e="$(head -c 64 /dev/urandom | base64)"
elif [ "$VERIFY_ONLY" = "1" ]; then
  for f in "$R1CS" "$PTAU_FINAL" "$ZKEY_FINAL"; do
    if [ ! -f "$f" ]; then
      echo "verify-setup: $f is missing — run scripts/compile.sh && npm run setup first" >&2
      exit 1
    fi
  done
else
  echo "Final zkey already present — verifying existing key material (no ceremony)."
fi

# ── 1. zkey integrity ────────────────────────────────────────────────────────
echo "→ snarkjs zkey verify ($R1CS + ${PTAU_FINAL##*/} → $ZKEY_FINAL)"
npx --yes snarkjs zkey verify "$R1CS" "$PTAU_FINAL" "$ZKEY_FINAL"

# ── 2. Verification-key drift check ──────────────────────────────────────────
npx --yes snarkjs zkey export verificationkey "$ZKEY_FINAL" "$VK_CANDIDATE"
if [ -f "$VK" ]; then
  if cmp -s "$VK_CANDIDATE" "$VK"; then
    echo "→ verification key matches the committed $VK"
  elif [ "$ALLOW_ROTATION" = "1" ]; then
    echo "⚠  ROTATION: installing a NEW verification key over the committed $VK"
    echo "   Every circle keeps the key it was created with; old circles will"
    echo "   no longer accept proofs generated under the new key."
    cp "$VK_CANDIDATE" "$VK"
    NEW_KEY=1
  else
    echo "" >&2
    echo "setup-verify: FAILED — exported verification key differs from the committed $VK" >&2
    echo "  The build artifacts reproduce a DIFFERENT key than the one recorded in" >&2
    echo "  circuits/verification_key.json. This normally means setup regenerated" >&2
    echo "  the key (each run draws fresh entropy) — an accidental key rotation" >&2
    echo "  that would leave every on-chain circle unable to verify new proofs." >&2
    echo "  If the rotation was intentional, rerun with --rotate:" >&2
    echo "      npm run setup -- --rotate" >&2
    rm -f "$VK_CANDIDATE"
    exit 1
  fi
else
  echo "→ no committed $VK — installing the new key (first ceremony)"
  mv "$VK_CANDIDATE" "$VK"
  NEW_KEY=1
fi
rm -f "$VK_CANDIDATE"

if [ "$NEW_KEY" = "0" ]; then
  echo "→ verification OK: build artifacts are consistent with the committed $VK."
  exit 0
fi

hash_file() {
  # Portable SHA-256: prefer sha256sum (Linux/WSL), fall back to shasum (macOS).
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "sha256-unavailable"
  fi
}

hash_file "$VK" > verification_key.json.sha256
hash_file "$BUILD/membership_js/membership.wasm" > membership.wasm.sha256
hash_file "$ZKEY_FINAL" > membership_final.zkey.sha256

echo ""
echo "Setup complete -> $ZKEY_FINAL, $VK"

# ── Transcript fingerprinting ────────────────────────────────────────────────
SNARKJS_VERSION="$(node -p 'require("./package.json").devDependencies.snarkjs' 2>/dev/null)"
DATE_NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

HASH_VK="$(hash_file "$VK")"
HASH_ZKEY="$(hash_file "$ZKEY_FINAL")"
HASH_PTAU="$(hash_file "$PTAU_FINAL")"

# Create the transcript file with a header if it doesn't exist yet.
if [ ! -f "$TRANSCRIPT" ]; then
cat > "$TRANSCRIPT" << 'HEADER'
# Sharibo Trusted-Setup Transcript

Each entry below records one ceremony run.  The **verification key hash** is
the authoritative fingerprint: it must match `shasum -a 256 verification_key.json`
(or `sha256sum verification_key.json` on Linux) for any set of local artifacts
to be considered canonical.

> ⚠️ **A new `setup.sh` run produces a brand-new verification key.**
> Any on-chain circle created with a previous vk stores that old key
> inside its contract state (written at `create_circle` time).  Proofs
> generated from the new key will **fail** to verify against those circles.
> All existing circles must be cancelled and recreated after a key rotation.

---

HEADER
fi

# Append the new entry.
cat >> "$TRANSCRIPT" << ENTRY
## Entry — $DATE_NOW

| Field              | Value |
|--------------------|-------|
| Date (UTC)         | \`$DATE_NOW\` |
| snarkjs version    | \`$SNARKJS_VERSION\` |
| Curve              | \`$CURVE\` |
| Powers-of-Tau power | $PTAU_POWER |
| \`verification_key.json\` SHA-256 | \`$HASH_VK\` |
| \`membership_final.zkey\` SHA-256  | \`$HASH_ZKEY\` |
| \`${PTAU_FINAL##*/}\` SHA-256  | \`$HASH_PTAU\` |

> Note: \`membership_final.zkey\` and the ptau file are **not committed** to the
> repository (they are large binary files listed in .gitignore).  Only
> \`verification_key.json\` and this transcript are committed.  To verify
> locally, rerun \`scripts/compile.sh && scripts/setup.sh\` and compare the
> \`verification_key.json\` hash against the entry above.

---

ENTRY

echo ""
echo "Transcript appended -> $TRANSCRIPT"
echo "  verification_key.json SHA-256: $HASH_VK"