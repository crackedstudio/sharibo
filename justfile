# Sharibo — local verification recipes
#
# Prerequisites: everything listed in README.md §0 (Rust, stellar CLI,
# Node.js 20+, circom).
#
# Gate definitions (do not invent a third):
#   just ci      = the complete, authoritative gate (what CI runs)
#   just verify  = fast pre-commit subset (typecheck + lint + unit tests)
#
# Keep genuinely-slow-or-networked work outside `ci`: e2e, circuits (trusted
# setup), mutation, bench-contract, bench-prove.
#
# Run `just --list` to see available recipes.
# Requires just >= 1.33.0 for set working-directory setting.
set working-directory := '.'

# ── Doctor ───────────────────────────────────────────────────────────────────

# Run the toolchain doctor script (checks Rust, stellar CLI, Node, circom, just)
doctor *ARGS:
    npm run doctor --workspace=scripts -- {{ARGS}}

# ── Audit ────────────────────────────────────────────────────────────────────

# Dependency audit gate: npm advisories across every workspace plus cargo
# advisories / licences / duplicate crates for the contracts crate.
#
# Findings are accepted only through the allowlist files below — never by
# appending `|| true` to a command:
#
#   * npm  — `audit-allowlist.json` (root): entries of the form
#            { "id": "GHSA-…", "reason": "…", "expires": "YYYY-MM-DD" }
#   * cargo — `contracts/deny.toml` `[advisories] ignore = [...]` entries,
#            each with a comment giving the reason and an expiry date.
#
# An allowlist entry past its expiry is a failure: re-triage the advisory
# instead of bumping the date.
audit:
    #!/usr/bin/env bash
    set -euo pipefail

    echo "== npm audit (all workspaces, --audit-level=high) =="
    npm audit --audit-level=high

    echo ""
    echo "== cargo audit (contracts/) =="
    cd contracts && cargo audit

    echo ""
    echo "== cargo deny check (advisories, licences, bans, sources) =="
    cd contracts && cargo deny check

    echo ""
    echo "audit: no unaccepted findings."

# ── Circuits ──────────────────────────────────────────────────────────────────

# Compile circuit, run trusted setup (with zkey verification), verify the
# exported vk against the committed one, and run circuit tests.
# NOT part of `just ci` — trusted setup is slow/stateful. Run on demand or
# via a scheduled/on-demand workflow.
circuits:
    cd circuits && npm run compile
    cd circuits && npm run setup
    cd circuits && npm run verify-setup
    cd circuits && npm test

# Circuit unit + checker failure-path tests only (no trusted setup).
# Safe for CI once dependencies are installed.
circuits-test:
    npm test --workspace=circuits

# ── Contract ──────────────────────────────────────────────────────────────────

# Run contract unit tests and build wasm binary
contract:
    cd contracts && cargo fmt --check
    cd contracts && cargo clippy --all-targets -- -D warnings
    cd contracts && cargo test
    cd contracts && stellar contract build

# Generate (or regenerate) the XDR golden files for Circle / VerificationKey /
# Proof. Full workflow (schema bump, client tests, commit steps) lives in
# contracts/sharibo/test_snapshots/xdr_goldens/README.md — start there.
xdr-goldens:
    cd contracts && UPDATE_GOLDEN=1 cargo test -p sharibo xdr_golden
    @echo ""
    @echo "Goldens written to contracts/sharibo/test_snapshots/xdr_goldens/"
    @echo "See contracts/sharibo/test_snapshots/xdr_goldens/README.md for follow-up steps."
    @echo "Review with: git diff --stat contracts/sharibo/test_snapshots/xdr_goldens/ test-vectors/xdr/"
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

# ── Lint / typecheck slices (invoked by ci + verify) ─────────────────────────

lint:
    npm run lint

typecheck:
    npm run typecheck --workspace=packages/client
    @if [ -f app/tsconfig.json ]; then cd app && npx --no-install tsc --noEmit; fi

# ── Client ────────────────────────────────────────────────────────────────────

# TypeScript typecheck AND unit/property tests for the client SDK
client:
    npm run typecheck --workspace=packages/client
    npm test --workspace=packages/client

# ── Scripts ───────────────────────────────────────────────────────────────────

# Run the scripts workspace unit tests (node --test).
# Hermetic: passes with networking disabled.
scripts-test:
    npm test --workspace=scripts

# Repo-structure / justfile hygiene (no duplicate recipe names, etc.)
repo-structure-test:
    node --import tsx/esm --test scripts/justfile-recipes.test.ts

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

    echo "\n== 4) Unit tests (app + packages/core + packages/client + circuits if present) =="; \
    npm run -s test --workspace=app || s_tests=1; \
    npm run -s test --workspace=packages/core || s_tests=1; \
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

cargo-fmt:
    cd contracts && cargo fmt --check

cargo-clippy:
    cd contracts && cargo clippy --all-targets -- -D warnings

cargo-test:
    cd contracts && cargo test

stellar-build:
    cd contracts && stellar contract build

# Build the TypeScript SDK package.
sdk-build:
    npm run build --workspace=packages/client --if-present

# ── CI (authoritative gate) ───────────────────────────────────────────────────
# Complete gate shared by local contributors and GitHub Actions.
# The workflow must call `just ci` (or the named slice recipes below) — never
# an inlined command list that can drift from this definition.
ci: sdk-build typecheck lint lint-dead scripts-test repo-structure-test client app-test circuits-test cargo-fmt cargo-clippy cargo-test stellar-build
    @echo "just ci: all gate checks passed."

# Fast pre-commit subset. Alias kept for muscle memory; NOT the full gate.
# Use `just ci` before opening a PR.
verify: typecheck lint client app-test
    @echo "just verify: fast subset passed. Run \`just ci\` before opening a PR."

# Browser end-to-end test of the whole demo flow (open page → create circle →
# fund 5 members → prove → claim) in headless Chromium, against a local Vite
# dev server. Soroban RPC and Friendbot are MOCKED, so this spends nothing; the
# Groth16 proving is still real (real wasm + zkey, in the browser).
#
# Needs the circuit artifacts (`just circuits`) — see docs/troubleshooting.md.
# Not part of `just test` / `npm test`. Failure traces: app/e2e/test-results/.
e2e-browser:
    npm run build --workspace=packages/client
    npm run sync-circuit --workspace=app
    cd app && npx playwright install chromium
    npm run test:e2e --workspace=app

# The same browser flow against LIVE testnet: SPENDS testnet funds and
# friendbot quota (like `just e2e`). Opt-in only; refuses to start unless
# app/.env (or the environment) has real testnet contract IDs.
e2e-browser-live:
    npm run build --workspace=packages/client
    npm run sync-circuit --workspace=app
    cd app && npx playwright install chromium
    E2E_LIVE=1 npm run test:e2e --workspace=app

# ── Test (all suites, no e2e) ─────────────────────────────────────────────────

# Run every test suite in the repo (still excludes e2e / trusted setup).
# Prefer `just ci` for the merge gate — this recipe is the test-only slice.
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
    run_suite "core tests"        npm test          --workspace=packages/core
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

# ── Slow / networked (outside ci) ─────────────────────────────────────────────

# Mutation testing for the crypto modules (identity.ts + tree.ts).
mutation:
    npm run mutate --workspace=packages/client

# Full e2e round against live testnet (spends friendbot quota / testnet funds)
e2e:
    npm run e2e

# Build all artefacts and run every test suite (excluding e2e).
all: circuits contract test
    @echo 'All recipes completed (e2e skipped — uses testnet funds/friendbot quota)'

# Run coverage for all workspaces and print a short per-workspace summary.
# Contracts coverage is a hard floor: cargo-llvm-cov --fail-under-lines reads
# coverage-thresholds.json (see contracts/README.md). Missing llvm-cov fails
# the recipe — do not swallow it with `|| true`.
coverage:
    #!/usr/bin/env bash
    set -euo pipefail
    echo 'Collecting coverage for: app, packages/client, scripts, contracts'
    # App / client / scripts stay best-effort (JS thresholds are separate).
    (cd app && npm test) || true
    npm run test --workspace=packages/client || true
    npm run test --workspace=scripts || true
    # Contracts: require cargo-llvm-cov and enforce the ratchet floor.
    if ! command -v cargo-llvm-cov >/dev/null 2>&1 && ! cargo llvm-cov --version >/dev/null 2>&1; then
      echo 'error: cargo-llvm-cov is not installed. Run: cargo install cargo-llvm-cov' >&2
      echo '       (or `just doctor` — the check is optional but recommended)' >&2
      exit 1
    fi
    THRESHOLD="$(python3 -c 'import json; print(json.load(open("coverage-thresholds.json"))["contracts"]["lines"])')"
    echo "Contracts line-coverage floor: ${THRESHOLD}%"
    mkdir -p contracts/coverage
    (cd contracts && cargo llvm-cov --workspace --tests \
      --ignore-filename-regex='(/tests?/|test\.rs$)' \
      --lcov --output-path coverage/lcov.info)
    # Threshold check is on `report` — the test invocation does not always
    # propagate --fail-under-lines when tests themselves succeed.
    (cd contracts && cargo llvm-cov report \
      --ignore-filename-regex='(/tests?/|test\.rs$)' \
      --fail-under-lines "${THRESHOLD}")
    echo
    echo 'Summary:'
    printf '%-25s %-28s %s\n' "Workspace" "Report" "Notes"
    printf '%-25s %-28s %s\n' "app" "coverage/app" "vitest + v8"
    printf '%-25s %-28s %s\n' "packages/client" "coverage/packages-client" "vitest + v8"
    printf '%-25s %-28s %s\n' "scripts" "(scripts workspace)" "node --test"
    printf '%-25s %-28s %s\n' "contracts" "contracts/coverage/lcov.info" "cargo llvm-cov (floor ${THRESHOLD}%)"

# Refresh the committed contract CPU benchmark table
bench-contract:
    WRITE_BENCHMARKS=1 cargo test -p sharibo cpu_instruction_benchmarks -- --nocapture

# Refresh the committed client proving benchmark table
bench-prove:
    WRITE_BENCHMARKS=1 npm run bench:prove --workspace=packages/client
