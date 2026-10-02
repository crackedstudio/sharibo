# Glossary

Plain-language definitions of cryptographic and protocol terms used throughout the Sharibo repository. Each entry links to the authoritative document rather than restating it at length.

If you are coming from the finance / ROSCA side rather than cryptography, start with the [ROSCA vocabulary](#rosca-vocabulary) section at the bottom.

---

### BLS12-381

A specific elliptic curve — think of it as the mathematical "field" on which Sharibo's zero-knowledge proofs run. Most ZK projects use BN254, but Stellar's Soroban blockchain natively accelerates BLS12-381 pairing operations, which is what makes on-chain verification actually fit within the transaction budget (BN254 doesn't).  
→ [`contracts/BENCHMARKS.md`](../contracts/BENCHMARKS.md) · [ADR 005](adr/005-bls12-381-curve-choice.md) · [`contracts/sharibo/src/lib.rs`](../contracts/sharibo/src/lib.rs)

### Circom

A domain-specific language for writing arithmetic circuits — the programs that describe what a zero-knowledge proof is proving. Sharibo's circuit (`membership.circom`) encodes "I am a member of this circle."  
→ [`circuits/membership.template.circom`](../circuits/membership.template.circom)

### Commitment

A cryptographic digest that binds to secret data without revealing it. In Sharibo, each member's leaf is `Poseidon(identityNullifier, identitySecret)` — the contract stores only this hash, never the raw secrets.  
→ [`packages/client/src/identity.ts`](../packages/client/src/identity.ts)

### Constraint

A single logical rule the circuit enforces (e.g., "this bit must be 0 or 1"). The number of constraints determines proof size and proving time. Sharibo's circuit uses ~1,453 constraints (after recipient binding).  
→ [`circuits/membership.template.circom`](../circuits/membership.template.circom)

### External nullifier

A value that binds a proof to a specific circle and round, so a proof generated for round 1 can't be replayed in round 2. Computed as `SHA256(circle_id, round) mod r` — SHA-256 is used here (not Poseidon) because this check lives on-chain where Soroban accelerates SHA-256 natively. Derivation and wire format live with the contract/client encoding docs, not here.  
→ [`contracts/sharibo/src/lib.rs`](../contracts/sharibo/src/lib.rs)

### fee_bps / basis points

Protocol fee charged on a successful claim, expressed in basis points (1 bp = 0.01%). `10_000` = 100% of the pot. `0` disables fees. Configured per circle at creation; settled to `fee_recipient` when the pot pays out.  
→ [`docs/adr/003-protocol-fees.md`](adr/003-protocol-fees.md)

### Groth16

A zero-knowledge proving system with the smallest proof size of any widely used scheme (~3 elliptic curve points). Sharibo uses Groth16 over BLS12-381: the contract verifies the proof via Soroban's native `pairing_check`.  
→ [`contracts/sharibo/src/lib.rs`](../contracts/sharibo/src/lib.rs)

### Identity nullifier / Identity secret

Two random numbers that together form a member's private identity. The nullifier is combined with the external nullifier to produce a one-time `nullifierHash` for claiming; the secret stays purely hidden. Neither is ever revealed on-chain.  
→ [`packages/client/src/identity.ts`](../packages/client/src/identity.ts)

### LeanIMT

Lean Incremental Merkle Tree — the off-chain Merkle tree shape Sharibo uses for member commitments. Depth can grow with membership without rewriting historical leaves; the on-chain contract only ever stores the current root.  
→ [`docs/adr/003-leanimt-dynamic-depth-merkle-tree.md`](adr/003-leanimt-dynamic-depth-merkle-tree.md)

### Merkle root / Merkle tree

A cryptographic data structure that commits to a set of values using only a single hash (the root). Sharibo puts every member's commitment into a Merkle tree and stores only the root on-chain. A claimant proves "my leaf is in this tree" without revealing _which_ leaf.  
→ [`packages/client/src/tree.ts`](../packages/client/src/tree.ts)

### Nullifier / Nullifier hash

A one-time marker that proves "this specific member already claimed" without identifying the member. `nullifierHash = Poseidon(identityNullifier, externalNullifier)` — the contract stores it permanently and rejects any future claim using the same value.  
→ [`contracts/sharibo/src/lib.rs`](../contracts/sharibo/src/lib.rs)

### Nullifier fence

Persistent storage that records spent nullifiers (and related round fencing) so a proof cannot be replayed after archival-adjacent TTL windows. Tied to how Soroban persists and extends entry lifetimes.  
→ [`docs/adr/004-storage-archival.md`](adr/004-storage-archival.md) · [`contracts/sharibo/src/lib.rs`](../contracts/sharibo/src/lib.rs)

### Pairing check

The mathematical operation that verifies a Groth16 proof. Soroban provides a native `bls12_381().pairing_check(vp1, vp2)` host function. Measured instruction costs for a real `claim()` live in the benchmarks doc — do not copy numbers here.  
→ [`contracts/BENCHMARKS.md`](../contracts/BENCHMARKS.md)

### Poseidon

A hash function designed specifically for zero-knowledge circuits — it uses far fewer constraints than traditional hashes like SHA-256. Sharibo uses Poseidon inside the circuit (for commitments and nullifiers) and a dedicated BLS12-381-compatible variant throughout. Constant provenance is documented separately.  
→ [`docs/poseidon-provenance.md`](poseidon-provenance.md) · [`test-vectors/poseidon.json`](../test-vectors/poseidon.json)

### Powers-of-Tau (ptau)

The first phase of a trusted setup ceremony: a multi-party computation that produces parameters later turned into a circuit-specific proving key. Sharibo's pipeline downloads or generates a `.ptau`, then runs the circuit-specific phase to produce the `.zkey`. Currently a **single-party** demo setup (insufficient for production).  
→ [`circuits/scripts/setup.sh`](../circuits/scripts/setup.sh) · [`circuits/SETUP_TRANSCRIPT.md`](../circuits/SETUP_TRANSCRIPT.md) · planned multi-party run [ceremony.md](ceremony.md)

### Proof (ZK proof)

A small piece of data (in Groth16: three elliptic curve points A, B, C) that proves a statement is true without revealing _why_ it's true. Sharibo's proof says: "one of the members is claiming the pot" — without revealing which one.  
→ [`contracts/sharibo/src/lib.rs`](../contracts/sharibo/src/lib.rs)

### Public inputs / Public signals

The values that both the prover and verifier agree on publicly. In Sharibo the ordered set is `[nullifierHash, root, externalNullifier, recipientHash]` (see [wire-format.md](wire-format.md) and [`test-vectors/public-signals.json`](../test-vectors/public-signals.json)). `recipientHash` is the SHA-256-derived hash of the payout address, supplied so the proof commits to where the pot goes. The proof demonstrates that some private inputs (identityNullifier, identitySecret, Merkle path) satisfy the circuit _given these public values_.  
→ [wire-format.md](wire-format.md) · [`docs/adr/006-recipient-binding.md`](adr/006-recipient-binding.md) · [`contracts/sharibo/src/lib.rs`](../contracts/sharibo/src/lib.rs)

### recipientHash

Public signal binding a claim proof to a specific payout address. Derived as a field element from the Stellar address bytes (SHA-256, reduced mod `r`) so a captured proof cannot be redirected to an attacker's wallet.  
→ [`docs/adr/006-recipient-binding.md`](adr/006-recipient-binding.md)

### round_deadline_ledgers / expire_round

Contract knobs for how long a funding round stays open in ledger time, and the entrypoint that marks an expired round. Used so a stuck round cannot hold the pot forever.  
→ [`contracts/sharibo/src/lib.rs`](../contracts/sharibo/src/lib.rs)

### SAC (Stellar Asset Contract)

The standard Soroban contract interface for a Stellar asset (including native XLM wrappers). Sharibo circles hold and transfer pot balances through a SAC address configured as `Circle::token` / `VITE_TEST_TOKEN_CONTRACT_ID`.  
→ [`app/.env.example`](../app/.env.example) · [`contracts/sharibo/src/lib.rs`](../contracts/sharibo/src/lib.rs)

### Scalar field (BLS12-381 scalar field)

The set of numbers used for all hash outputs and field arithmetic in Sharibo — the modulus is the large prime `r` defined by the BLS12-381 curve. Every Poseidon hash, nullifier, and commitment lives in this field.  
→ [`contracts/sharibo/src/lib.rs`](../contracts/sharibo/src/lib.rs)

### schema_version

Integer stamped on persisted circle / protocol state so storage layouts can migrate safely across contract upgrades without silently misreading old bytes.  
→ [`docs/adr/003-storage-migration.md`](adr/003-storage-migration.md)

### Trusted setup / toxic waste

The one-time process that generates the proving key (`.zkey`) and verification key for a Groth16 circuit. Participants contribute randomness and must destroy their portion afterward ("toxic waste"); if any share survives, forged proofs become possible. Sharibo's current single-party setup is documented and committed; a production deployment would need a multi-party ceremony.  
→ [`circuits/SETUP_TRANSCRIPT.md`](../circuits/SETUP_TRANSCRIPT.md) · [README §Honest limitations](../README.md#honest-limitations)

### TTL / archival / extend_ttl

Soroban deletes (archives) persistent contract data whose time-to-live expires. Sharibo extends TTL on writes (`extend_ttl`) so live circles stay readable; dormant circles may need a restore before further interaction.  
→ [`docs/adr/004-storage-archival.md`](adr/004-storage-archival.md)

### Verification key (vk)

The public key produced during trusted setup, stored on-chain in each `Circle`. The contract uses it to check that submitted proofs were generated from the correct circuit — without it, anyone could submit a fake proof.  
→ [`circuits/verification_key.json`](../circuits/verification_key.json)

### Witness

The complete set of values (public + private inputs + all intermediate computations) that satisfy a circuit. In Sharibo, the witness includes the member's secret identity, the Merkle path, and every intermediate Poseidon hash — all computed locally, never sent to the contract. Building the witness is what the `.wasm` witness generator does before the `.zkey` proving step.  
→ [`circuits/membership.template.circom`](../circuits/membership.template.circom)

### zkey

Circuit-specific proving key produced by the trusted-setup Phase 2. Large binary; not committed to git. The app copies it into `public/circuits/` via `sync-circuit` after `circuits` setup.  
→ [`circuits/scripts/setup.sh`](../circuits/scripts/setup.sh)

### Zero-knowledge proof (ZKP)

A cryptographic technique where one party (the prover) convinces another (the verifier) that a statement is true without revealing anything beyond the truth of the statement itself. Sharibo's ZK proof convinces the contract "this person is a member" without revealing which member.  
→ [`contracts/sharibo/src/lib.rs`](../contracts/sharibo/src/lib.rs)

---

## ROSCA vocabulary

Sharibo is a private **ROSCA** (rotating savings and credit association). The same social structure has many local names — the README lists them so people recognise the product. Short definitions:

| Name                    | Region / language notes                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| **ajo** / **esusu**     | Nigeria and wider West Africa (Yoruba and neighbours) — fixed contribution, rotating payout. |
| **tanda** / **cundina** | Mexico and parts of Latin America.                                                           |
| **susu**                | Ghana, Caribbean, and diaspora communities.                                                  |
| **tontine**             | Francophone West Africa and historical European mutual savings.                              |
| **junta** / **pandero** | Peru and Andean communities.                                                                 |
| **consórcio**           | Brazil — often more formalised, still rotating credit at heart.                              |
| **hui**                 | China / Taiwan rotating savings circles.                                                     |
| **paluwagan**           | Philippines.                                                                                 |
| **chit fund**           | India — legally regulated variants exist; the social pattern is the same.                    |

Mechanics are always the same: fixed contribution per round, one payout per round, rotate until everyone has collected once. Sharibo puts that pattern on Stellar and anonymizes the _payout_ side with a ZK proof.
