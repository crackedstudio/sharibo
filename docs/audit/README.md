# Audit package index (#547)

**Status:** Preparation only — **no third-party audit has been completed** for this repository. Nothing here is an audit report or a substitute for one.

This folder collects material an engagement team would need to reproduce claims, scope work, and find test gaps. It is maintained so an audit can start without reverse-engineering the monorepo layout.

## Pinned toolchain (reproduce the build)

| Tool          | Version / source                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Rust          | `rustc 1.92.0` (see root README); target `wasm32v1-none` for Soroban                            |
| `stellar` CLI | `23.4.1` (README)                                                                               |
| Node.js       | `v24.11.1` (README); workspaces root + `circuits/` + `packages/client/`                         |
| circom        | `2.2.3` (pinned in `circuits/config.json`, asserted by `compile.sh`; prebuilt Linux x64 binary) |
| snarkjs       | `0.7.6` (`circuits/package.json`, via `npx`)                                                    |

Everything above is also available as one reproducible image: `Dockerfile.circuits`
pins circom, Node and Rust. Build it with `docker build -t sharibo-circuits .` and
run the circuit suite with
`docker run --rm -v "$(pwd):/sharibo" -w /sharibo sharibo-circuits`.

The committed `verification_key.json` is canonical — consume it, never regenerate
it. A CI-generated setup would be a different, untrusted key (see
`circuits/README.md` "Trusted setup is stateful").

## Reproduce circuit + verification artifacts

```bash
cd circuits
npm ci
npm run compile
npm run setup          # single-party demo unless docs/ceremony.md was executed
npm run verify-setup
npm test
npm run prove          # optional: local prove + snarkjs verify
```

Contract tests (includes real Groth16 fixtures):

```bash
cd contracts && cargo test
```

Client / cross-implementation:

```bash
npm test -w packages/client
npm test -w packages/core
```

Committed canonical vk fingerprint: [`circuits/SETUP_TRANSCRIPT.md`](../../circuits/SETUP_TRANSCRIPT.md).

## Claimed properties (what the code intends to enforce)

See [`docs/threat-model.md`](../threat-model.md) for the structured list. High level:

- **Membership:** Groth16 soundness of Merkle inclusion + commitment in `membership.template.circom`
- **One claim per round per nullifier:** nullifier map keyed by `(circle_id, nullifier_hash)`
- **Round binding:** `external_nullifier` must match `SHA256(circle_id, round)` reduced to `Fr`
- **Recipient binding:** fourth public signal `recipientHash` must match contract-side hash of payout address ([ADR 006](../adr/006-recipient-binding.md))
- **Pot gating:** `pot == contribution * size` before payout
- **Proof integrity:** BLS12-381 pairing check in `verify_groth16`

## Scope pointers

- Engagement draft: [SCOPE.md](SCOPE.md)
- Negative / adversarial tests: [NEGATIVE_TESTS.md](NEGATIVE_TESTS.md)
- Curve: [ADR 005](../adr/005-bls12-381-curve-choice.md)
- Wire format / public inputs: [wire-format.md](../wire-format.md)
- Poseidon constants: [poseidon-provenance.md](../poseidon-provenance.md)
- Constraint metadata: [`circuits/constraints.json`](../../circuits/constraints.json)
- Trusted setup **honesty** (not yet multi-party): [SETUP_TRANSCRIPT.md](../../circuits/SETUP_TRANSCRIPT.md), planned ceremony [ceremony.md](../ceremony.md) (#546)

## Known limitations auditors should not treat as bugs

- Testnet-only deployment; no real funds (README, SECURITY.md)
- **Single-contributor** Groth16 setup — toxic-waste holder can forge proofs for any vk derived from that ceremony
- Third-party Poseidon BLS12-381 packages without independent constant generation audit
- Claim-side privacy only; funding is public

## Issue tracking

Formal audit engagement prep: **#547**. Multi-party setup execution: **#546**.
