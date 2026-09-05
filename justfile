# Sharibo — local verification recipes
#
# Prerequisites: everything listed in README.md §0 (Rust, stellar CLI,
# Node.js 20+, circom).
#
# Run `just --list` to see available recipes.  Any recipe can be run
# manually with the raw commands in README.md — `just` is optional.
#
# Requires just >= 1.33.0 for set working-directory setting.
set working-directory := '.'

# ── Doctor ───────────────────────────────────────────────────────────────────

# Run the toolchain doctor script (checks Rust, stellar CLI, Node, circom, just)
doctor:
    npm run doctor --workspace=scripts

# ── Circuits ──────────────────────────────────────────────────────────────────

# Compile circuit, run trusted setup (with zkey verification), verify the
# exported vk against the committed one, and run circuit tests
circuits:
    cd circuits && npm run compile
    cd circuits && npm run setup
    cd circuits && npm run verify-setup
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
# ── Dead-code check ───────────────────────────────────────────────────────────

# Check for unused files, exports, and dependencies across all TS workspaces.
# Zero issues is the baseline — adding an unreferenced module makes this fail.
#
# To mark an intentional public export so knip ignores it, add the JSDoc tag:
#
#   /** @public */
#   export function myApi() { … }
#
# See knip.jsonc for the full configuration and workspace entry points.
lint-dead:
    npm run lint:dead

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

# ── Verify (umbrella) ───────────────────────────────────────────────────────────
# Run a complete local verification/gate for contributors. This intentionally
# excludes the slow or networked pieces: the `e2e` job (uses testnet/friendbot)
# and the circuits *trusted setup* (slow and stateful). Use this as the
# single pre-PR check to answer "did I break anything?".
verify:
    @root=$(git rev-parse --show-toplevel 2>/dev/null || printf "%s" "$(pwd)"); \
    echo "Running verify from $root"; \
    cd "$root"; \
    set -o pipefail; \
    s_type=0; s_eslint=0; s_deadcode=0; s_tests=0; s_cargo=0; \

    echo "\n== 1) TypeScript typecheck (packages/client + app if present) =="; \
    npm run -s typecheck --workspace=packages/client || s_type=1; \
    if [ -f app/package.json ]; then (cd app && npx -y tsc --noEmit) || s_type=1; fi; \

    echo "\n== 2) ESLint =="; \
    npx -y eslint . --ext .js,.ts,.tsx || s_eslint=1; \

    echo "\n== 3) Dead-code check (ts-prune; best-effort) =="; \
    npx -y ts-prune --summary || s_deadcode=1; \

    echo "\n== 4) Unit tests (app + packages/client + circuits if present) =="; \
    npm run -s test --workspace=app || s_tests=1; \
    npm run -s test --workspace=packages/client || s_tests=1; \
    if [ -f circuits/package.json ]; then (cd circuits && npm test --if-present) || true; fi; \

    echo "\n== 5) Cargo tests & clippy =="; \
    (cd contracts && cargo test) || s_cargo=1; \
    (cd contracts && cargo clippy -- -D warnings) || s_cargo=1; \

    echo "\nSummary:"; \
    printf "%-36s %s\n" "TypeScript typecheck" "$( [ $s_type -eq 0 ] && echo PASS || echo FAIL )"; \
    printf "%-36s %s\n" "ESLint" "$( [ $s_eslint -eq 0 ] && echo PASS || echo FAIL )"; \
    printf "%-36s %s\n" "Dead-code (ts-prune)" "$( [ $s_deadcode -eq 0 ] && echo PASS || echo WARN )"; \
    printf "%-36s %s\n" "Unit tests (app + client)" "$( [ $s_tests -eq 0 ] && echo PASS || echo FAIL )"; \
    printf "%-36s %s\n" "Cargo tests + clippy" "$( [ $s_cargo -eq 0 ] && echo PASS || echo FAIL )"; \

    if [ $s_type -eq 0 -a $s_eslint -eq 0 -a $s_tests -eq 0 -a $s_cargo -eq 0 ]; then \
        echo "\nverify: All checks passed."; \
    else \
        echo "\nverify: Some checks failed. See above for details."; \
        exit 2; \
    fi

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

    run_suite "dead-code check"   npm run lint:dead
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

# Verify: run lint and client checks
verify: client
    npm run lint

# Run coverage for all workspaces and print a short per-workspace summary.
# This is a local instrument (not a merge gate). It runs each workspace's
# test command with coverage enabled and emits the report locations.
coverage:
    @echo 'Collecting coverage for: app, packages/client, scripts, contracts'
    # App (vitest will write to coverage/app)
    cd app && npm test || true
    # Client (vitest will write to coverage/packages-client)
    npm run test --workspace=packages/client || true
    # Scripts (node --test may be used by the scripts workspace)
    npm run test --workspace=scripts || true
    # Contracts (cargo-llvm-cov must be installed; see contracts/README.md)
    cd contracts && cargo llvm-cov --workspace --tests --lcov --output-path coverage || true
    @echo
    @echo 'Summary:'
    @printf '%-25s %-12s %s\n' "Workspace" "Report" "Notes"
    @printf '%-25s %-12s %s\n' "app" "coverage/app" "vitest + v8"
    @printf '%-25s %-12s %s\n' "packages/client" "coverage/packages-client" "vitest + v8"
    @printf '%-25s %-12s %s\n' "scripts" "(scripts test may output coverage)" "node --test"
    @printf '%-25s %-12s %s\n' "contracts" "contracts/coverage" "cargo llvm-cov (HTML/lcov)"

# Refresh the committed contract CPU benchmark table
bench-contract:
    WRITE_BENCHMARKS=1 cargo test -p sharibo cpu_instruction_benchmarks -- --nocapture
