# Dependency Policy

## Pinning Rationale

Specific dependencies are pinned to exact versions to ensure reproducible builds and cryptographic compatibility across the monorepo.

- **`poseidon-bls12381` (`1.0.2`) and `poseidon-bls12381-circom` (`1.0.0`)**: These MUST be pinned exactly. They are cryptographic primitives whose BLS12-381 field arithmetic must move together across circuits, contracts, and the client SDK. A mismatched version pair would silently produce incompatible proofs or signatures.

- **`react` (`19.2.7`) and `react-dom` (`19.2.7`)**: Strictly pinned to guarantee build stability and avoid unexpected React behavior changes (e.g., concurrent mode, automatic batching) that could affect the frontend.

- **`vite` (`8.1.3`)**: Pinned to lock in the plugin API and tooling surface that the build pipeline depends on.

- **`@stellar/stellar-sdk`**: Pinned to a single version range (`^16.2.0`) across all workspaces to prevent a partial bump from silently installing two copies of the SDK, which would cause version skew in signing and encoding logic.

## Update Cadence

- **Monthly**: `npm audit` and `cargo audit` must be run to detect vulnerabilities. These checks are part of the local verification gate (`just verify`).

- **Quarterly**: Minor version bumps should be evaluated and applied. The lead maintainer (or the developer assigned to the quarterly maintenance chore) is responsible for executing this.

- **Patch**: Patch-level updates may be applied at any time if they resolve critical security issues, following the same verification process.

## Verification (No CI Rule)

> **This repository currently does not run CI. Therefore, all dependency updates must be thoroughly built, tested, and verified locally before being merged into the main branch.**

Contributors must run the full local verification gate (`just verify`) after any dependency change to confirm that TypeScript compilation, linting, unit tests, circuit tests, and contract tests all pass.

## Existing Guards

- `scripts/maintenance/check-stellar-sdk-version.mjs` exists specifically to enforce alignment of the `@stellar/stellar-sdk` version across the `app`, `packages/client`, and `scripts` workspaces. This script will exit with a non-zero status if the version ranges differ, preventing a partial bump from going unnoticed.