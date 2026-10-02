# Audit engagement scope (draft)

**This is a scope proposal, not evidence that an audit occurred.**

## In scope

### 1. Circuit soundness — `circuits/membership.template.circom`

- Merkle inclusion (`MerkleTreeChecker`) — boolean path indices, sibling ordering, root binding
- Commitment: `Poseidon255(2)` over `(identityNullifier, identitySecret)`
- Nullifier output: `Poseidon255(2)` over `(identityNullifier, externalNullifier)`
- Recipient binding: `recipientHash` public input with squaring constraint (#266)
- Public signal count and order vs [wire-format.md](../wire-format.md)
- Field: BLS12-381 (`--prime bls12381`)
- Poseidon parameter provenance — [poseidon-provenance.md](../poseidon-provenance.md), [`circuits/constraints.json`](../../circuits/constraints.json)

### 2. Setup pipeline

- Scripts: `compile.sh`, `setup.sh`, `verify-setup.sh`, `prove.sh`
- Integrity checks: `snarkjs zkey verify`, committed vk guard (#271)
- **Explicitly out of current assurance:** multi-party phase-2 contributions (planned — [ceremony.md](../ceremony.md), #546). Reviewers should treat the committed vk as **single-contributor demo** unless transcript entries include attested multi-party steps.

### 3. Circuit ↔ contract public-input agreement

- `Contract::claim` public input vector vs snarkjs order ([wire-format.md](../wire-format.md))
- `VerificationKey.ic` length vs number of public inputs
- `compute_external_nullifier` and `compute_recipient_hash` byte layouts vs client (`packages/client/src/identity.ts`, `@sharibo/core`)

### 4. On-chain verifier — `contracts/sharibo/src/lib.rs`

- Groth16 pairing equation over BLS12-381 host functions
- Check ordering in `claim` (pot, round tag, nullifier, proof, recipient guards, transfer)
- Fee path (`apply_fee`) interaction with payout when enabled
- Storage: nullifier replay, schema versioning

### 5. Client encoding — `packages/client/src/prove.ts`

- `encodeG1` / `encodeG2` vs Soroban layouts
- `verificationKeyToContractFormat`
- Input validation in `validateCircuitInput`

## Out of scope (unless separately contracted)

- Frontend UX (`app/`) except where it affects secret handling or proof submission
- Operational key custody, monitoring, incident response ([mainnet-readiness.md](../mainnet-readiness.md))
- Economic / MEV analysis on Stellar mainnet
- Formal verification of circom compiler or snarkjs
- Legal / regulatory compliance

## Deliverables (expected from auditor)

- Written report with severity-rated findings
- Confirmation of reproduced vk hash / test pass matrix (or documented deltas)
- Explicit statement on whether single-party setup blocks production use (expected: yes, for Groth16 toxic waste)

## References

- [threat-model.md](../threat-model.md)
- [NEGATIVE_TESTS.md](NEGATIVE_TESTS.md)
- [README.md](../../README.md) honest limitations
