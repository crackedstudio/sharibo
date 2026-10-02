# Sharibo — architecture

This is the detailed version of the [Repository structure](../README.md#repository-structure) section in the README. It maps each directory to its responsibility, the toolchain it runs on, and how the pieces fit together end to end. For a file-by-file account, see [breakdown §16](../full_product_breakdown.md#16-repository-structure); for the full documentation index, see [docs/index.md](index.md).

## Ownership map

| Directory | Responsibility | Toolchain | Tests | Issue label |
| --------- | -------------- | --------- | ----- | ----------- |
| [**`app/`**](../app/README.md) | Browser demo: generates a real proof client-side and drives `create`/`fund`/`claim` against testnet | TypeScript, React 19, Vite, Vitest | `npm test` | `frontend` |
| [**`packages/client/`**](../packages/client/README.md) | Isomorphic TS SDK shared by `app/` and `scripts/` | TypeScript, snarkjs, `@stellar/stellar-sdk` | `npm test -w packages/client` | `sdk` |
| [**`contracts/`**](../contracts/README.md) | Soroban contract that verifies Groth16 proofs on-chain | Rust, soroban-sdk 23, `wasm32v1-none` | `cd contracts && cargo test` | `contracts` |
| [**`circuits/`**](../circuits/README.md) | Zero-knowledge membership circuit + trusted-setup pipeline | Circom 2.2.3, snarkjs, bash | `cd circuits && npm test` | `circuits` |
| [**`scripts/`**](../scripts/package.json) | Node/TS helpers: e2e round runner, smoke health check | TypeScript, tsx | `npm test -w scripts` | `e2e` / `dx` |
| [**`docs/`**](index.md) | Long-form documentation (this file included) | Markdown | — | `documentation` |
| [**`judges/`**](../judges/VERIFY.md) | Judge-facing proof-of-real verification guide | Markdown | — | `documentation` |
| [**`test-vectors/`**](../test-vectors/generate.mjs) | Cross-implementation Poseidon fixture vectors | JSON, Node | exercised by client/circuit suites | `testing` |

## End-to-end data flow

The diagram below is the "who talks to whom" view, complementing the [flowchart in the README](../README.md#architecture).

```text
app/ (browser)  ──prove──▶  packages/client/  ◀──prove──  scripts/e2e.ts
   │                          │  │
   │     @sharibo/client       │  │  @stellar/stellar-sdk
   │                          │  │
   └──────────▶  contracts/sharibo (Soroban)  ◀───────────┘
                       │
                       │ env.crypto().bls12_381().pairing_check(...)
                       ▼
                BLS12-381 pairing verification
```

1. **`app/`** loads the compiled artifacts that [`circuits/`](../circuits/README.md) produces (`membership.wasm`, `membership_final.zkey`, `verification_key.json`), copied by `npm run sync-circuit` into `app/public/circuits/`.
2. **`packages/client/`** owns the encoding math: Poseidon commitments and the Merkle tree (`tree.ts`), Groth16 proof generation via snarkjs (`prove.ts`), and the contract invocation wrappers (`contract.ts`), all on the BLS12-381 scalar field.
3. **`contracts/sharibo`** validates each `claim`: pot fully funded → round tag matches → nullifier unused → real pairing check passes against the stored verification key.
4. **`scripts/e2e.ts`** reproduces the same round from the CLI against live testnet; **`scripts/smoke.ts`** is a cheap read-only health probe.

## Invariants shared across circuit / contract / client

These are non-negotiable across all the directories touched by a change — see [README invariants](../README.md#invariants-held-across-circuit--contract--client):

- **BLS12-381 everywhere.** Soroban only accelerates BLS12-381 pairing operations; a pure-Rust BN254 check exceeds the 100M instruction budget. Every layer must agree.
- **Commitment:** `leaf = Poseidon(identityNullifier, identitySecret)`.
- **Nullifier:** `nullifierHash = Poseidon(identityNullifier, externalNullifier)`.
- **Round tag:** `externalNullifier = SHA256(circle_id, round) mod r`, computed outside the circuit.
- **Public signal order:** `[nullifierHash, root, externalNullifier]` — circuit, contract, and client must all agree.

## Where to dig deeper

- Fresh-machine setup: [README: Run it](../README.md#run-it) and [troubleshooting](troubleshooting.md).
- Security properties and limits: [threat model](threat-model.md).
- Poseidon constant provenance: [poseidon-provenance.md](poseidon-provenance.md).
- Decision records: [docs/adr](adr/).
# Sharibo — Package Architecture & Import Rules

## Layer Diagram

```
┌─────────────────────────────────────────────┐
│  app/          (Vite, React, browser)        │
│  scripts/      (Node, e2e / smoke scripts)   │
└───────────────────┬─────────────────────────┘
                    │ imports via package entry point only
                    │ (@sharibo/client — never a deep src/ path)
┌───────────────────▼─────────────────────────┐
│  packages/client/   (TypeScript SDK)        │
│  May import: circuit *artifacts* (JSON)     │
│  Must NOT import: app/, scripts/            │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  contracts/    (Soroban / Rust — no JS deps)│
│  circuits/     (Circom circuits — no JS deps│
│                 other than build tooling)   │
└─────────────────────────────────────────────┘
```

## Rules (enforced by ESLint `no-restricted-imports`)

| Consumer | May import | Must NOT import |
|---|---|---|
| `app/` | `@sharibo/client` (entry point) | `packages/client/src/**` (deep paths) |
| `scripts/` | `@sharibo/client` (entry point) | `packages/client/src/**` (deep paths) |
| `packages/client` | circuit artifacts (`circuits/**/*.json`) | `app/`, `scripts/` |
| `contracts/` | nothing in this repo | — |
| `circuits/` | nothing in this repo | — |

## Rationale

- **Deep imports from `app/` or `scripts/` into `packages/client/src/`** couple consumers
  to SDK internals. When the SDK refactors internally the consumer breaks even though the
  public API is unchanged.
- **The SDK importing `app/`** would drag browser-only code (React, DOM globals) into
  Node scripts and make the SDK un-tree-shakeable.
- **`contracts/` and `circuits/`** are entirely separate build systems (Cargo and
  circom/snarkjs) and must have zero JavaScript import dependencies on the rest of the
  monorepo.

## Checking compliance

```sh
npm run lint
```

A deliberately-added deep import such as:

```ts
// app/src/foo.ts
import { fr_from_dec_str } from "../../packages/client/src/prove";
```

will produce an ESLint error and fail the lint step.
