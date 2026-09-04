# Sharibo — local verification recipes
#
# Prerequisites: everything listed in README.md §0 (Rust, stellar CLI,
# Node.js 20+, circom).
#
# Run `just --list` to see available recipes.  Any recipe can be run
# manually with the raw commands in README.md — `just` is optional.

# ── Circuits ──────────────────────────────────────────────────────────────────

# Compile circuit, run trusted setup, and run circuit tests
circuits:
    cd circuits && npm run compile
    cd circuits && npm run setup
    cd circuits && npm test

# ── Contract ──────────────────────────────────────────────────────────────────

# Run contract unit tests and build wasm binary
contract:
    cd contracts && cargo test
    cd contracts && stellar contract build

# Generate (or regenerate) the XDR golden files for Circle / VerificationKey /
# Proof.  Run this whenever you intentionally change the wire format, then
# commit the updated .b64 files alongside the struct change.
#
# After running this, also update packages/client/src/contract.test.ts if
# any expected field values or struct shapes changed, and bump SCHEMA_VERSION
# in contracts/sharibo/src/test.rs.
xdr-goldens:
    cd contracts && UPDATE_GOLDEN=1 cargo test -p sharibo xdr_golden
    @echo ""
    @echo "Goldens written to contracts/sharibo/test_snapshots/xdr_goldens/"
    @echo "Review with: git diff --stat contracts/sharibo/test_snapshots/xdr_goldens/"

# ── Client ────────────────────────────────────────────────────────────────────

# TypeScript typecheck AND unit/property tests for the client SDK
client:
    npm run typecheck --workspace=packages/client
    npm test --workspace=packages/client

# ── Scripts ───────────────────────────────────────────────────────────────────

# Run the scripts workspace unit tests (node --test)
scripts-test:
    npm test --workspace=scripts

# ── App ───────────────────────────────────────────────────────────────────────

# Run the app's vitest suite (headless, no server)
app-test:
    npm test --workspace=app

# Start the browser demo dev server (does NOT run tests — use app-test for that)
app-dev:
    cd app && npm run dev

# Mutation testing for the crypto modules (identity.ts + tree.ts).
# Runs on demand — not part of the default test run.
# Requires: npm install --workspace=packages/client (installs Stryker).
# Expected runtime: ~3–8 minutes depending on CPU.
# HTML report written to packages/client/reports/mutation/mutation.html.
# Baseline mutation score (recorded 2026-08-31): see packages/client/MUTATION_SCORE.md.
mutation:
    npm run mutate --workspace=packages/client

# ── End-to-end ────────────────────────────────────────────────────────────────

# Full e2e round against live testnet (spends friendbot quota / testnet funds)
e2e:
    npm run e2e

# ── Test (all suites, no e2e) ─────────────────────────────────────────────────

# Run every test suite in the repo.
# Fails as soon as any suite fails; the summary at the end lists all results.
# e2e is excluded — it requires live testnet funds and friendbot quota.
test:
    #!/usr/bin/env bash
    set -euo pipefail

    pass=()
    fail=()

    run_suite() {
        local name="$1"; shift
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "  Running: $name"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        if "$@"; then
            pass+=("$name")
        else
            fail+=("$name")
        fi
    }

    run_suite "client typecheck"  npm run typecheck --workspace=packages/client
    run_suite "client tests"      npm test          --workspace=packages/client
    run_suite "app tests"         npm test          --workspace=app
    run_suite "scripts tests"     npm test          --workspace=scripts
    run_suite "contract tests"    bash -c 'cd contracts && cargo test'
    run_suite "circuit tests"     npm test          --workspace=circuits

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Test summary"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    for s in "${pass[@]+"${pass[@]}"}"; do echo "  ✓  $s"; done
    for s in "${fail[@]+"${fail[@]}"}"; do echo "  ✗  $s"; done
    echo ""

    if [ ${#fail[@]} -gt 0 ]; then
        echo "  ${#fail[@]} suite(s) failed."
        exit 1
    fi
    echo "  All ${#pass[@]} suites passed."

# ── All (build + test, except e2e) ────────────────────────────────────────────

# Build all artefacts and run every test suite (excluding e2e).
# Equivalent to running circuits, contract, client, and test in sequence.
all: circuits contract test
    @echo 'All recipes completed (e2e skipped — uses testnet funds/friendbot quota)'
