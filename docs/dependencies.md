# Dependency Update Cadence and Lockfile Policy

## Pinning Rationale

The following dependencies are pinned to exact versions to maintain cryptographic compatibility and reproducibility:

- **`poseidon-bls12381`** and **`poseidon-bls12381-circom`** — These must move together. Both are intentionally pinned to exact versions (`1.0.2` and `1.0.0` respectively) to avoid breaking zero-knowledge cryptographic compatibility. The circom twin mirrors the rust implementation version; any mismatch would cause proof verification failures.

- **`react`** and **`react-dom`** — Pinned to `19.2.7` in `app/package.json` to ensure a consistent browser experience and avoid unexpected UI breaks from minor React releases.

- **`vite`** — Pinned to `8.1.3` in `app/package.json` to lock the build pipeline and plugin surface area.

All other dependencies use npm semver ranges (e.g., `^16.2.0`) and may be updated within major version boundaries following the cadence below.

## Update Cadence

- **Monthly:** Run `npm audit` and `cargo audit` to detect vulnerabilities.
- **Quarterly:** Schedule minor version bumps for non-crypto dependencies (e.g., `@stellar/stellar-sdk`, `react`, `vite`). Major version bumps require explicit review and testing.
- **Maintainers** are responsible for executing this cadence. Any contributor may propose a version bump via a draft PR, but it must follow the verification policy below.

## Verification Policy

Because this repository runs **no CI pipeline**, all dependency updates must be verified locally before merging:

1. Run the typecheck script: `npm run typecheck --workspace=packages/client`
2. Run `npm run check:stellar-sdk-version` to ensure `@stellar/stellar-sdk` is consistent across workspaces.
3. Verify circuits compile and constants are valid: `cd circuits && npm run check-constants`
4. Run the local test suite: `npm test --workspaces --if-present`
5. Confirm `cargo audit` passes for the `contracts/` directory.

No change should be merged unless all four verification steps pass locally.

## Lockfile

- `package-lock.json` is the authoritative lockfile for npm dependencies.
- `Cargo.lock` is the authoritative lockfile for Rust dependencies in `contracts/`.
- Both lockfiles are committed to version control and must not be regenerated lightly.
