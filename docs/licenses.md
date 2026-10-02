# Third-Party Licenses

This document records the licenses of every direct, non-workspace dependency of Sharibo and flags copyleft obligations that may affect downstream users.

> **Project license:** [MIT](../LICENSE)
>
> **Last updated:** 2026-07-29
>
> **Scope:** Direct dependencies declared in each workspace `package.json` / `Cargo.toml`. Transitive dependencies are not enumerated here.

---

## npm — runtime dependencies

These packages are bundled or loaded when the SDK (`@sharibo/client`) or the browser app (`@sharibo/app`) runs.

| Package                    | Version   | Workspace            | License        | Notes                                                                                             |
| -------------------------- | --------- | -------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `@stellar/stellar-sdk`     | `^16.0.1` | client, app, scripts | **Apache-2.0** | Stellar Development Foundation                                                                    |
| `poseidon-bls12381`        | `1.0.2`   | client, circuits     | **MIT**        | Poseidon hash over BLS12-381 scalar field. Copyright © 2024 Juan Salvador Magán Valero            |
| `poseidon-bls12381-circom` | `1.0.0`   | circuits             | **MIT**        | Circom template for Poseidon-BLS12-381. Copyright © 2024 Juan Salvador Magán Valero               |
| `snarkjs`                  | `0.7.6`   | client, circuits     | **GPL-3.0** ⚠️ | zkSNARK proof generation & verification (iden3). [See copyleft note below](#gpl-30-copyleft-note) |
| `buffer`                   | `^6.0.3`  | app                  | **MIT**        | Polyfill for Node.js `Buffer` in the browser                                                      |
| `react`                    | `19.2.7`  | app                  | **MIT**        | Meta (Facebook)                                                                                   |
| `react-dom`                | `19.2.7`  | app                  | **MIT**        | Meta (Facebook)                                                                                   |

---

## npm — dev / test / build dependencies

These packages are only used during development, testing, or CI. They are **not** shipped to end users.

| Package                | Version  | Workspace                 | License        | Notes                                                                          |
| ---------------------- | -------- | ------------------------- | -------------- | ------------------------------------------------------------------------------ |
| `chai`                 | `6.2.2`  | circuits                  | **MIT**        | Assertion library                                                              |
| `circom_tester`        | `0.0.24` | circuits                  | **GPL-3.0** ⚠️ | Circuit test harness (iden3). [See copyleft note below](#gpl-30-copyleft-note) |
| `mocha`                | `11.7.6` | circuits                  | **MIT**        | Test runner                                                                    |
| `tsx`                  | `4.22.4` | client, circuits, scripts | **MIT**        | TypeScript execute (esbuild-based)                                             |
| `typescript`           | `6.0.3`  | client, app               | **Apache-2.0** | Microsoft                                                                      |
| `@types/snarkjs`       | `0.7.9`  | client                    | **MIT**        | Type definitions for snarkjs                                                   |
| `@types/react`         | `^19.2`  | app                       | **MIT**        | Type definitions for React                                                     |
| `@types/react-dom`     | `^19.2`  | app                       | **MIT**        | Type definitions for React DOM                                                 |
| `@vitejs/plugin-react` | `6.0.3`  | app                       | **MIT**        | Vite React plugin                                                              |
| `vite`                 | `8.1.3`  | app                       | **MIT**        | Build tool & dev server                                                        |

---

## Rust / Cargo — runtime & dev dependencies

| Crate           | Version | Crate type     | License               | Notes                                     |
| --------------- | ------- | -------------- | --------------------- | ----------------------------------------- |
| `soroban-sdk`   | `23`    | dependency     | **Apache-2.0**        | Stellar Development Foundation            |
| `ark-bls12-381` | `0.6`   | dev-dependency | **MIT OR Apache-2.0** | arkworks — BLS12-381 curve implementation |
| `ark-ff`        | `0.6`   | dev-dependency | **MIT OR Apache-2.0** | arkworks — finite field traits            |
| `ark-ec`        | `0.6`   | dev-dependency | **MIT OR Apache-2.0** | arkworks — elliptic curve traits          |
| `ark-serialize` | `0.6`   | dev-dependency | **MIT OR Apache-2.0** | arkworks — serialization                  |

The arkworks crates are used **only** in the contract test suite (`contracts/sharibo/src/test.rs`) to construct and verify BLS12-381 field elements in test assertions. They are **not** compiled into the deployed WASM contract binary.

---

## GPL-3.0 copyleft note

### `snarkjs` (GPL-3.0)

**Where it's used:**

- **Build pipeline** (`@sharibo/circuits`): `snarkjs` performs the Powers-of-Tau ceremony, Groth16 trusted setup (`membership_final.zkey`), and exports `verification_key.json`. The circuit test suite also uses it for proof verification.
- **Client SDK at runtime** (`@sharibo/client`): The `prove.ts` module imports `snarkjs` to generate Groth16 proofs in the browser. The browser app loads `membership.wasm` and `membership_final.zkey` (both produced by snarkjs) and calls snarkjs's `groth16.fullProve()`.

**Copyleft implications:**

- `snarkjs` is declared as a direct `dependency` (not `devDependency`) in `@sharibo/client`, meaning it is installed and linked at runtime by anyone who depends on `@sharibo/client`.
- The GPL-3.0 is a strong copyleft license. If the GPL interpretation applies to your use case, distributing a work that links to GPL-3.0 code may require the combined work to also be distributed under GPL-3.0-compatible terms.
- **Artifact question**: `membership_final.zkey` and `verification_key.json` are _outputs_ of snarkjs (a code-generation / setup tool), not derivatives of snarkjs source code. Many projects treat such outputs as not subject to the tool's license. This is a common but not universally settled interpretation — consult your own counsel if this matters for your deployment.

**Practical impact for Sharibo:**

- The project's own source code is MIT-licensed and does not include GPL code.
- End users who install the SDK receive snarkjs as a transitive dependency. This is transparent to them — they are not modifying or redistributing snarkjs itself.
- If you plan to distribute a bundled/compiled version of the app (e.g., a desktop or mobile wrapper), review whether the GPL-3.0's conveyance requirements are triggered.

### `circom_tester` (GPL-3.0)

- Used **only** as a `devDependency` in `@sharibo/circuits` for running the circuit test suite.
- It is never shipped, bundled, or linked at runtime. **No copyleft risk for end users.**

---

## Summary by license category

| License               | Packages                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **MIT**               | poseidon-bls12381, poseidon-bls12381-circom, buffer, react, react-dom, chai, mocha, tsx, @types/*, @vitejs/plugin-react, vite |
| **Apache-2.0**        | @stellar/stellar-sdk, typescript, soroban-sdk                                                                                 |
| **MIT OR Apache-2.0** | ark-bls12-381, ark-ff, ark-ec, ark-serialize (dual-licensed)                                                                  |
| **GPL-3.0** ⚠️        | snarkjs (runtime dependency), circom_tester (dev-only)                                                                        |

---

## Verification

To re-verify these licenses at any time:

```bash
# npm packages (all workspaces)
for pkg in circuits packages/client app scripts; do
  echo "=== $pkg ==="
  jq -r '.dependencies // {} | to_entries[] | "\(.key)@\(.value)"' "$pkg/package.json"
  jq -r '.devDependencies // {} | to_entries[] | "\(.key)@\(.value)"' "$pkg/package.json"
done

# Check a specific package's license from the npm registry
npm view <package-name> license

# Rust crates
cargo license --manifest-path contracts/Cargo.toml  # requires `cargo-license`
```
