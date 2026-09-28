# Sharibo — documentation index

Every document in this repository, with a one-line description of what
each covers and where to find it.

---

## Core project docs (root)

| File | Description |
|---|---|
| [`README.md`](../README.md) | Project overview, architecture, on-chain evidence, and fresh-machine setup guide |
| [`NOTES.md`](../NOTES.md) | **Historical** append-only build log — not authoritative for current invariants |
| [`full_product_breakdown.md`](../full_product_breakdown.md) | Complete technical deep-dive: every system layer, engineering decisions, security properties, honest limitations |
| [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) | Contributor code of conduct |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | Contribution workflow, code-ownership map, SDK API-surface and pre-PR checklist |
| [`SECURITY.md`](../SECURITY.md) | Security policy and responsible disclosure |
| [`TODO.md`](../TODO.md) | Completed a11y live-region task checklist (historical scratch note) |
| [`LICENSE`](../LICENSE) | Project license |

## Hackathon-era artifacts (`docs/hackathon/` — point-in-time archive, not maintained)

These files carry an in-file archive notice. Doc-accuracy / structure checks
must skip `docs/hackathon/**` explicitly (see `scripts/doc-archive.mjs`) —
an archive is allowed to contain stale claims.

| File | Description |
|---|---|
| [`hackathon/hackathon_demo_script.md`](hackathon/hackathon_demo_script.md) | Annotated 2m20s demo video script (shot list, voiceover, overlays, recording checklist) |
| [`hackathon/dorahacks_submission.md`](hackathon/dorahacks_submission.md) | DoraHacks submission form text (project description, evidence, honest scope) |
| [`hackathon/VERIFY.md`](hackathon/VERIFY.md) | Historical one-minute judge verification guide (stale testnet IDs; see README for current evidence) |

## Architecture

| File | Description |
|---|---|
| [`architecture.md`](architecture.md) | Detailed version of the README's repository structure: directory ownership, toolchains, and end-to-end data flow |
| [`wire-format.md`](wire-format.md) | Authoritative public signal order and Groth16 byte encodings across circuit, contract, and client |
| [`canary.md`](canary.md) | Scheduling `scripts/e2e.ts` on testnet; foreground-run constraint |
| [`ceremony.md`](ceremony.md) | **Planned** multi-party trusted-setup runbook (#546) — not executed |
| [`poseidon-provenance.md`](poseidon-provenance.md) | Poseidon-over-BLS12-381 constants: packages, verification status, risks |
| [`roadmap.md`](roadmap.md) | Mainnet readiness checklist (no target dates) |
| [`threat-model.md`](threat-model.md) | Assets, adversaries, and which code enforces each property |
| [`troubleshooting.md`](troubleshooting.md) | Common setup and proof-verification failures |
| [`observability.md`](observability.md) | SDK `SdkEvent` taxonomy (`onEvent`) for retries, proofs, artifacts, transactions |
| [`deployment.md`](deployment.md) | How the live browser demo is built and manually deployed to Vercel |
| [`glossary.md`](glossary.md) | Plain-language crypto + ROSCA terms |
| [`errors.md`](errors.md) | Contract error-code table: Rust variant -> docs -> SDK class mapping |
| [`licenses.md`](licenses.md) | Licenses of every direct third-party dependency and copyleft obligations |

## Architecture decision records (`docs/adr/`)

| File | Description |
|---|---|
| [`adr/001-upgradeability.md`](adr/001-upgradeability.md) | ADR 001: decision to keep the contract immutable and defer admin rotation |
| [`adr/002-multi-round-turn-ordering.md`](adr/002-multi-round-turn-ordering.md) | ADR 002: multi-round turn ordering and cycle-scoped nullifier behavior |
| [`adr/003-client-boundary.md`](adr/003-client-boundary.md) | ADR 003: app ↔ SDK ↔ contract boundary and the current free-function design |
| [`adr/003-protocol-fees.md`](adr/003-protocol-fees.md) | ADR 003 (fees): protocol fee on claim |
| [`adr/003-storage-migration.md`](adr/003-storage-migration.md) | ADR 003 (schema): `schema_version` field and the Circle-layout migration playbook |
| [`adr/003-leanimt-dynamic-depth-merkle-tree.md`](adr/003-leanimt-dynamic-depth-merkle-tree.md) | ADR 003 (LeanIMT): rejected dynamic-depth Merkle tree, with the constraint-count analysis |
| [`adr/004-storage-archival.md`](adr/004-storage-archival.md) | ADR 004: per-key storage TTL/archival analysis, including the nullifier double-claim fence's residual risk |
| [`adr/005-bls12-381-curve-choice.md`](adr/005-bls12-381-curve-choice.md) | ADR 005: BLS12-381 instead of BN254 (CPU budget) |
| [`adr/006-recipient-binding.md`](adr/006-recipient-binding.md) | ADR 006: `recipientHash` public input for payout binding |

## Audit prep (`docs/audit/` — not an audit report)

| File | Description |
|---|---|
| [`audit/README.md`](audit/README.md) | Audit package index: toolchain pins, repro steps, scope links (#547) |
| [`audit/SCOPE.md`](audit/SCOPE.md) | Draft engagement scope for circuit, setup, contract, client |
| [`audit/NEGATIVE_TESTS.md`](audit/NEGATIVE_TESTS.md) | Existing negative tests and known gaps |

## Operations

| File | Description |
|---|---|
| [`runbook-testnet-reset.md`](runbook-testnet-reset.md) | Operator runbook for the quarterly Stellar testnet reset: redeploy, re-fund, re-run e2e |

## Circuit docs

| File | Description |
|---|---|
| [`circuits/README.md`](../circuits/README.md) | Circuit build pipeline, BLS12-381 usage, and Poseidon provenance |
| [`circuits/SETUP_TRANSCRIPT.md`](../circuits/SETUP_TRANSCRIPT.md) | Transcript of trusted-setup runs (currently single-contributor) |

## Contract docs

| File | Description |
|---|---|
| [`contracts/README.md`](../contracts/README.md) | Contract build and deploy instructions |
| [`contracts/BENCHMARKS.md`](../contracts/BENCHMARKS.md) | CPU instruction benchmarks and gas analysis for contract entrypoints |

## Configuration examples

| File | Description |
|---|---|
| [`.env.example`](../.env.example) | Example environment variables for the root/scripts |
| [`app/.env.example`](../app/.env.example) | Example environment variables for the browser demo |

---

### Quick links by topic

- **Just getting started:** [`README.md`](../README.md)
- **Historical build narrative:** [`NOTES.md`](../NOTES.md)
- **Wire format / public signals:** [`wire-format.md`](wire-format.md)
- **Deep technical dive:** [`full_product_breakdown.md`](../full_product_breakdown.md)
- **Historical verify checklist (archived):** [`hackathon/VERIFY.md`](hackathon/VERIFY.md)
- **Building the circuit:** [`circuits/README.md`](../circuits/README.md)
- **Building the contract:** [`contracts/README.md`](../contracts/README.md)
- **Architecture decisions:** [`adr/001-upgradeability.md`](adr/001-upgradeability.md)
- **Audit readiness (not audited):** [`audit/README.md`](audit/README.md)
