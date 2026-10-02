# ADR 005: BLS12-381 curve choice (not BN254)

- **Status:** Accepted
- **Date:** 2025-07-01 (Phase 3 pivot; recorded here in #545)
- **Context:** Original build spec assumed BN254/bn128 throughout (Circom default, circomlib Poseidon). Soroban on-chain verification must fit the protocol CPU budget.

## Context

Stellar Soroban's host crypto module (`soroban_sdk::crypto::bls12_381`) exposes accelerated pairing and EC operations **only for BLS12-381**. There is no BN254/bn128 host support.

The alternative — pure-Rust BN254 pairing via `ark-bn254`, following Stellar's `stellar/soroban-examples/import_ark_bn254` reference — was measured at **~560M CPU instructions for a single pairing** against Soroban's **100M** per-transaction instruction ceiling. Groth16 verification requires a product of several pairings, so pure-Rust BN254 verification does not fit at all.

Stellar's own `groth16_verifier` reference example verifies over **BLS12-381** using `env.crypto().bls12_381().pairing_check(...)`, not BN254.

## Decision

Build the **entire** pipeline on BLS12-381:

- Circom compile with `--prime bls12381` (`circuits/scripts/compile.sh`)
- Powers-of-Tau and Groth16 setup on curve `bls12381` (`circuits/scripts/setup.sh`)
- Poseidon parameters for the BLS12-381 scalar field (not circomlib's BN254-only constants) — see [docs/poseidon-provenance.md](../poseidon-provenance.md)
- Contract Groth16 verifier using native `pairing_check`, `g1_mul`, `g1_add`
- Client proof encoding matching Soroban's G1/G2 layouts — see [docs/wire-format.md](../wire-format.md)

## Consequences

- **On-chain cost:** A real `claim()` with four public inputs stays ~51.5M instructions (~51% of budget). Dominated by pairing (~30.3M) and G1 scalar multiplications for public inputs. See [contracts/BENCHMARKS.md](../../contracts/BENCHMARKS.md) and `claim_fits_cpu_budget` / `cpu_instruction_benchmarks` in `contracts/sharibo/src/test.rs`.
- **Ecosystem friction:** Most ZK tutorials and tooling default to BN254; contributors must not accidentally compile or setup on bn128.
- **Poseidon:** circomlib Poseidon constants cannot be reused; third-party BLS12-381 Poseidon packages are used with documented provenance and known audit gaps ([poseidon-provenance.md](../poseidon-provenance.md)).
- **Round-tag binding:** `externalNullifier` uses SHA-256 outside the circuit (contract + client), not Poseidon — Soroban has native SHA-256 and no native Poseidon; matching hash functions outside the SNARK would not reduce on-chain cost. This is permanent, not a placeholder.

## References

- [contracts/BENCHMARKS.md](../../contracts/BENCHMARKS.md) — BN254 ~560M vs BLS12-381 measured `claim` costs
- [docs/poseidon-provenance.md](../poseidon-provenance.md) — field modulus cross-check against `BLS12_381_FR_MODULUS_BE`
- Historical discovery log: [NOTES.md](../../NOTES.md) Phase 3 (append-only, not authoritative)
