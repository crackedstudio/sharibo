#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NODE_MIN=20
CIRCOM_MIN="2.1.6"
STELLAR_MIN="21.0.0"

if [ -t 1 ]; then
  BOLD=$'\033[1m'
  RED=$'\033[31m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  CYAN=$'\033[36m'
  RESET=$'\033[0m'
else
  BOLD=""
  RED=""
  GREEN=""
  YELLOW=""
  CYAN=""
  RESET=""
fi

info() { printf '%s\n' "${CYAN}==>${RESET} $*"; }
ok() { printf '%s\n' "${GREEN} ok ${RESET} $*"; }
warn() { printf '%s\n' "${YELLOW} !! ${RESET} $*" >&2; }
die() {
  printf '%s\n' "${RED}error:${RESET} $*" >&2
  exit 1
}
section() { printf '\n%s%s%s\n\n' "$BOLD" "$CYAN" "==> $*"; }

have() { command -v "$1" >/dev/null 2>&1; }

first_semver() { printf '%s' "$1" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true; }

version_ge() { [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]; }

SKIP_TESTS=0
for arg in "$@"; do
  case "$arg" in
    --skip-tests) SKIP_TESTS=1 ;;
    -h|--help)
      cat <<'USAGE'
Usage: ./scripts/bootstrap.sh [--skip-tests]

One-command setup for a fresh machine:
  1. checks prerequisites (node >= 20, npm, cargo, stellar CLI, circom >= 2.1.6)
  2. runs `npm install`
  3. compiles the circuit + runs the trusted setup (circuits/scripts/{compile,setup}.sh)
  4. runs the circuit test suite (unless --skip-tests)
  5. creates .env from .env.example if missing and prints which variables still need filling

It never deploys contracts or spends funds.
USAGE
      exit 0
      ;;
    *) die "unknown option: $arg (supported: --skip-tests, --help)" ;;
  esac
done

section "Checking prerequisites"

FAILURES=""

if have node; then
  NODE_VERSION="$(node --version)"
  NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  if [ "${NODE_MAJOR:-0}" -ge "$NODE_MIN" ]; then
    ok "node $NODE_VERSION (>= v$NODE_MIN required)"
  else
    FAILURES+="  - node $NODE_VERSION found but >= v$NODE_MIN is required.
      install: https://nodejs.org/ or https://github.com/nvm-sh/nvm
"
  fi
else
  FAILURES+="  - node not found (>= v$NODE_MIN required).
      install: https://nodejs.org/ or https://github.com/nvm-sh/nvm
"
fi

if have npm; then
  ok "npm $(npm --version)"
else
  FAILURES+="  - npm not found (it ships with Node.js).
      install: https://nodejs.org/
"
fi

if have cargo; then
  ok "cargo $(cargo --version 2>/dev/null | awk '{print $2}')"
  if have rustup && ! rustup target list --installed 2>/dev/null | grep -q '^wasm32v1-none$'; then
    warn "rust target wasm32v1-none is not installed yet — needed later for 'stellar contract build' (not by this script): rustup target add wasm32v1-none"
  fi
else
  FAILURES+="  - cargo not found (Rust toolchain).
      install: https://rustup.rs/
      then:    rustup target add wasm32v1-none
"
fi

if have stellar; then
  STELLAR_VERSION="$(first_semver "$(stellar version 2>/dev/null || stellar --version 2>/dev/null || true)")"
  if [ -n "$STELLAR_VERSION" ] && ! version_ge "$STELLAR_VERSION" "$STELLAR_MIN"; then
    FAILURES+="  - stellar CLI v$STELLAR_VERSION found but >= v$STELLAR_MIN is required (protocol 22+ for BLS12-381 host functions).
      upgrade: https://developers.stellar.org/docs/tools/cli/install-cli
"
  else
    ok "stellar CLI ${STELLAR_VERSION:+v$STELLAR_VERSION}"
  fi
else
  FAILURES+="  - stellar CLI not found.
      install: https://developers.stellar.org/docs/tools/cli/install-cli
"
fi

if have circom; then
  CIRCOM_VERSION="$(first_semver "$(circom --version 2>/dev/null || true)")"
  if [ -z "$CIRCOM_VERSION" ]; then
    FAILURES+="  - could not parse 'circom --version'; circom >= $CIRCOM_MIN is required.
      install: https://docs.circom.io/getting-started/installation/
"
  elif ! version_ge "$CIRCOM_VERSION" "$CIRCOM_MIN"; then
    FAILURES+="  - circom v$CIRCOM_VERSION found but >= v$CIRCOM_MIN is required.
      upgrade: https://docs.circom.io/getting-started/installation/
"
  else
    ok "circom v$CIRCOM_VERSION (>= v$CIRCOM_MIN required)"
  fi
else
  FAILURES+="  - circom not found (>= v$CIRCOM_MIN required).
      install: https://docs.circom.io/getting-started/installation/
"
fi

if [ -n "$FAILURES" ]; then
  printf '%s\n' "${RED}${BOLD}Missing prerequisites:${RESET}"
  printf '%s' "$FAILURES"
  die "install the tools above and re-run ./scripts/bootstrap.sh"
fi

ENV_FILE=".env"
CREATED_ENV=0
if [ -f "$ENV_FILE" ]; then
  ok ".env already exists — leaving it untouched (this script never overwrites it)"
else
  cp .env.example "$ENV_FILE"
  CREATED_ENV=1
  info "created .env from .env.example"
fi

EMPTY_KEYS="$(tr -d '\r' <"$ENV_FILE" | grep -E '^[A-Z][A-Z0-9_]*=[[:space:]]*$' | cut -d= -f1 || true)"

section "Installing dependencies"
npm install --no-fund --no-audit

section "Compiling circuit"
bash circuits/scripts/compile.sh

section "Trusted setup (Powers-of-Tau + Groth16 zkey)"
if [ -f circuits/build/membership_final.zkey ]; then
  ok "circuits/build/membership_final.zkey already exists — skipping setup"
  warn "re-running the trusted setup rotates the verification key; delete circuits/build/ only if you really want that (see README 'Changing the Merkle tree depth')"
else
  bash circuits/scripts/setup.sh
fi

if [ "$SKIP_TESTS" -eq 1 ]; then
  info "skipping circuit tests (--skip-tests)"
else
  section "Running circuit tests"
  npm test --workspace=circuits
fi

ADMIN_EMPTY=0
MEMBER_EMPTY=0
RECIPIENT_EMPTY=0
CONTRACT_IDS_EMPTY=""
OTHER_EMPTY=""

while IFS= read -r key; do
  [ -z "$key" ] && continue
  case "$key" in
    ADMIN_SECRET_KEY | ADMIN_PUBLIC_KEY) ADMIN_EMPTY=1 ;;
    MEMBER_SECRET_KEY | MEMBER_PUBLIC_KEY) MEMBER_EMPTY=1 ;;
    RECIPIENT_PUBLIC_KEY) RECIPIENT_EMPTY=1 ;;
    HELLO_WORLD_CONTRACT_ID | SHARIBO_CONTRACT_ID | TEST_TOKEN_CONTRACT_ID)
      CONTRACT_IDS_EMPTY="${CONTRACT_IDS_EMPTY:+$CONTRACT_IDS_EMPTY }$key"
      ;;
    *) OTHER_EMPTY="${OTHER_EMPTY:+$OTHER_EMPTY }$key" ;;
  esac
done <<EOF
$EMPTY_KEYS
EOF

section ".env checklist"

if [ "$ADMIN_EMPTY" -eq 0 ] && [ "$MEMBER_EMPTY" -eq 0 ] && [ "$RECIPIENT_EMPTY" -eq 0 ] &&
  [ -z "$CONTRACT_IDS_EMPTY" ] && [ -z "${OTHER_EMPTY// /}" ]; then
  ok ".env has no empty variables — nothing left to fill in"
else
  echo "These variables in .env are still empty. Fill them in as follows:"
  echo "(commands come straight from README §1 — this script does NOT deploy contracts or spend funds)"

  if [ "$ADMIN_EMPTY" -eq 1 ]; then
    echo "
  ADMIN_SECRET_KEY / ADMIN_PUBLIC_KEY:
      stellar keys generate admin --network testnet --fund
      stellar keys show admin
        -> paste S... into ADMIN_SECRET_KEY, G... into ADMIN_PUBLIC_KEY"
  fi

  if [ "$MEMBER_EMPTY" -eq 1 ]; then
    echo "
  MEMBER_SECRET_KEY / MEMBER_PUBLIC_KEY:
      stellar keys generate member --network testnet --fund
      stellar keys show member
        -> paste S... into MEMBER_SECRET_KEY, G... into MEMBER_PUBLIC_KEY"
  fi

  if [ "$RECIPIENT_EMPTY" -eq 1 ]; then
    echo "
  RECIPIENT_PUBLIC_KEY:
      any funded testnet address (G...). Note: scripts/e2e.ts generates its own
      fresh recipient per run, so this may stay empty unless your tooling needs it."
  fi

  if [ -n "$CONTRACT_IDS_EMPTY" ]; then
    echo "
  Contract IDs ($CONTRACT_IDS_EMPTY):
      filled in AFTER you deploy — see 'Next steps' below. For the pot token on testnet:
      stellar contract id asset --asset native --network testnet   -> TEST_TOKEN_CONTRACT_ID"
  fi

  if [ -n "${OTHER_EMPTY// /}" ]; then
    echo "
  Other ($OTHER_EMPTY):
      set a value in .env (see the comments in .env.example)"
  fi
fi

section "Next steps (not run by bootstrap)"

cat <<'NEXTSTEPS'
Bootstrap complete. This script never deploys contracts or spends funds.

  1. Fill every variable listed in the .env checklist above.

  2. When you are ready to deploy (that part DOES move testnet XLM):
       cd contracts
       cargo test
       stellar contract build
       stellar contract deploy \
         --wasm target/wasm32v1-none/release/sharibo.wasm \
         --source admin --network testnet
       cd ..
     then paste into .env:
       SHARIBO_CONTRACT_ID=<id returned by the deploy command>
       TEST_TOKEN_CONTRACT_ID=<output of: stellar contract id asset --asset native --network testnet>

  3. Health-check the deployment (read-only, no keys needed beyond contract IDs):
       npm run smoke

  4. Run a full round against live testnet (creates circle, funds, proves, claims):
       npm run e2e

  5. Browser demo:
       cd app && cp .env.example .env && npm run dev

  Problems? See docs/troubleshooting.md.
NEXTSTEPS
