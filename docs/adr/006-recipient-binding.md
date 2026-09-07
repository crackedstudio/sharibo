# ADR 006: Recipient binding strategy

- **Status:** Accepted
- **Date:** 2026-08-31
- **Context:** Issue #275. Design decision on how to bind payout destinations to ZK proofs, preventing front-running and proof transfer.

## Context

The Sharibo circuit proves membership and emits a nullifier to prevent double-claiming, but does not currently bind the proof to a specific recipient. This means a valid proof could be intercepted and submitted by anyone to claim the pot to an arbitrary address — a front-running attack.

Two approaches exist to solve this:

1. **Per-proof binding** (issue #266): Add `recipientHash` as a public input to the circuit. The prover commits to a specific recipient in each proof, and the contract verifies this public signal against the expected payout-address hash.

2. **Join-time binding** (this ADR): Make the payout address part of the identity commitment itself: `commitment = Poseidon(identityNullifier, identitySecret, payoutAddressHash)`. The member commits to where their winnings go when they join the circle.

## Decision drivers

### Approach A — Per-proof binding (implemented in #266)

Add `signal input recipientHash;` and a squaring constraint `recipientSquare <== recipientHash * recipientHash;` to the membership circuit. The public signal order becomes `[nullifierHash, root, externalNullifier, recipientHash]`.

**Pros:**
- Flexible: recipient can change each round (member picks a fresh address per claim)
- Minimal circuit change: +1 constraint (squaring), no change to commitment structure
- No trusted setup re-generation needed (only the existing zkey changes)
- Compatible with existing identity generation (`Poseidon(nullifier, secret)`)

**Cons:**
- Prover must know the recipient at proof generation time
- Contract must verify the additional public signal
- Slightly larger public input vector (4 signals instead of 3)

**Constraint count:** 1,453 (was 1,452 before #266)

### Approach B — Join-time binding (arity-3 commitment)

Change the commitment hasher from `Poseidon255(2)` to `Poseidon255(3)`:
```
commitment = Poseidon(identityNullifier, identitySecret, payoutAddressHash)
```

The member commits to a payout address at join time. The circuit proves the recipient matches the committed one without revealing which member it is.

**Pros:**
- Harder to get wrong: payout address is fixed for the circle's lifetime
- No per-proof recipient selection needed (simpler UX for claimers)
- Recipient is cryptographically bound to identity, not just the proof

**Cons:**
- Inflexible: payout address cannot change after joining
- A member who loses access to that address loses their turn permanently
- Requires changing the identity generation and all existing commitments
- Changes the Merkle tree leaf shape (all existing circles invalidated)
- May require trusted setup re-generation (different constraint system)

**Constraint count estimate:** Each `Poseidon255(2)` instance costs ~315 constraints (BLS12-381 Poseidon with a 3-element state and 8 full + 57 partial rounds). `Poseidon255(3)` adds one more state element, requiring additional round constants and S-box evaluations — estimated at ~345-365 constraints (delta: +30-50). With MerkleTreeChecker unchanged at ~820 constraints, the estimated total is ~1,480-1,500 constraints (vs 1,452 for the current arity-2 design).

### Why per-proof binding is better for Sharibo

Sharibo's core use case is a **rotating savings circle** where members take turns claiming. The payout address should ideally be:
- **Fresh each round** (privacy: no address reuse across rounds)
- **Chosen at claim time** (flexibility: member can use a different address)
- **Not tied to identity** (the identity is for membership, not payment routing)

Join-time binding conflates identity with payment routing, which is a conceptual mismatch. A member's identity should prove "I am in this circle" — not "I want to be paid at this specific address forever." The per-proof approach keeps these concerns separate.

Additionally, join-time binding would invalidate all existing circles and require a full re-deployment ceremony, making it impractical for an incremental improvement.

## Decision

**Adopt per-proof binding (Approach A)** as the recipient-binding strategy. Join-time binding (Approach B) becomes a documented non-goal.

Specifically:
1. The `recipientHash` public input added in #266 is the canonical approach.
2. Do not change the identity commitment to arity-3 (`Poseidon(nullifier, secret, payoutHash)`).
3. Document this decision so future contributors understand why the commitment is arity-2.

## Consequences

- **Front-running protection:** A proof is bound to a specific recipient. An interceptor cannot submit the proof to claim to a different address — the contract will reject the mismatched `recipientHash` public signal.
- **Flexibility:** Members can choose a fresh recipient for each claim, improving privacy by avoiding address reuse across rounds.
- **No ceremony changes:** The existing trusted setup and verification key remain valid (only the public signal list changes, which is a verifier-side concern, not a circuit-constraint-system change).
- **Future consideration:** If a product requirement later demands identity-level payout binding (e.g., for regulatory compliance where the payout address must be known at registration), this ADR should be revisited. The arity-3 approach remains technically feasible but would require a new circuit, new trusted setup, and migration of all existing circles.
