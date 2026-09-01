# Sharibo — documentation index

Every document in this repository, with a one-line description of what
each covers and where to find it.

---

## Core project docs (root)

| File | Description |
|---|---|
| [`README.md`](../README.md) | Project overview, architecture, on-chain evidence, and fresh-machine setup guide |
| [`NOTES.md`](../NOTES.md) | Raw build log and decision record — what was discovered, when, and why |
| [`full_product_breakdown.md`](../full_product_breakdown.md) | Complete technical deep-dive: every system layer, engineering decisions, security properties, honest limitations |
| [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) | Contributor code of conduct |
| [`SECURITY.md`](../SECURITY.md) | Security policy and responsible disclosure |
| [`LICENSE`](../LICENSE) | Project license |

## Hackathon-era artifacts (`docs/hackathon/`)

| File | Description |
|---|---|
| [`hackathon/hackathon_demo_script.md`](hackathon/hackathon_demo_script.md) | Annotated 2m20s demo video script (shot list, voiceover, overlays, recording checklist) |
| [`hackathon/dorahacks_submission.md`](hackathon/dorahacks_submission.md) | DoraHacks submission form text (project description, evidence, honest scope) |

## Architecture decision records (`docs/adr/`)

| File | Description |
|---|---|
| [`adr/001-upgradeability.md`](adr/001-upgradeability.md) | ADR 001: decision to keep the contract immutable and defer admin rotation |

## Cross-implementation specification

| File | Description |
|---|---|
| [`wire-format.md`](wire-format.md) | Authoritative wire-format spec: public signal order, external nullifier derivation, G1/G2 encoding, vk.ic length rules — validated by `test-vectors/wire-format.json` |

## Circuit docs

| File | Description |
|---|---|
| [`circuits/README.md`](../circuits/README.md) | Circuit build pipeline, BLS12-381 usage, and Poseidon provenance |
| [`circuits/SETUP_TRANSCRIPT.md`](../circuits/SETUP_TRANSCRIPT.md) | Transcript of the trusted-setup ceremony run |

## Contract docs

| File | Description |
|---|---|
| [`contracts/README.md`](../contracts/README.md) | Contract build and deploy instructions |

## Verifiability

| File | Description |
|---|---|
| [`judges/VERIFY.md`](../judges/VERIFY.md) | One-minute verification guide: confirm the on-chain proof is real without installing anything |

## Configuration examples

| File | Description |
|---|---|
| [`.env.example`](../.env.example) | Example environment variables for the root/scripts |
| [`app/.env.example`](../app/.env.example) | Example environment variables for the browser demo |

---

### Quick links by topic

- **Just getting started:** [`README.md`](../README.md), [`NOTES.md`](../NOTES.md)
- **Deep technical dive:** [`full_product_breakdown.md`](../full_product_breakdown.md)
- **Wire format / cross-implementation spec:** [`wire-format.md`](wire-format.md)
- **Verifying the on-chain proof:** [`judges/VERIFY.md`](../judges/VERIFY.md)
- **Building the circuit:** [`circuits/README.md`](../circuits/README.md)
- **Building the contract:** [`contracts/README.md`](../contracts/README.md)
- **Architecture decisions:** [`docs/adr/001-upgradeability.md`](adr/001-upgradeability.md)
