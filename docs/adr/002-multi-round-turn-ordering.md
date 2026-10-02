# ADR 002: Multi-round turn ordering (one claim per member per cycle)

- **Status:** Proposed
- **Date:** 2026-07-29
- **Context:** Design for issue #91. Implementation is a follow-up; this ADR only fixes the design and records the verification work behind it.

## Context

A real ROSCA rotates: N members, N rounds, everyone claims exactly once per
cycle before the cycle repeats. Today the contract does not enforce that.

**Verified current semantics** (see `same_identity_can_claim_two_consecutive_rounds`
in `contracts/sharibo/src/test.rs`, added alongside this ADR): the same
identity **can** claim in round 0 and again in round 1 of the same circle,
back to back, with no error.

Why: `nullifierHash = Poseidon(identityNullifier, externalNullifier)` inside
the circuit (`circuits/membership.template.circom`), and `externalNullifier`
is bound on-chain to `(circle_id, round)` via
`Contract::compute_external_nullifier`. Because `round` changes on every
successful claim, the same identity produces a **different** `nullifierHash`
each round. The contract's replay guard —
`DataKey::Nullifier(circle_id, nullifier_hash)` — is keyed on that
per-round-varying hash, so it only ever blocks _resubmitting the same
round's proof twice_ (`second_claim_with_same_nullifier_reverts` already
covers that). It does not — and structurally cannot, as currently bound —
block one identity from claiming every round of a cycle.

This is not a bug in code tested elsewhere in this file; `WrongRoundTag` and
`AlreadyClaimed` both do exactly what they're supposed to do per-round. It's
a real gap one level up: nothing currently enforces "each member claims
exactly once per N-round cycle."

## Decision drivers

### Option A — cycle-scoped external nullifier (recommended)

Bind `externalNullifier` to `(circle_id, cycle)` instead of
`(circle_id, round)`, where `cycle = round / size` (integer division; a
cycle is exactly `size` rounds, matching "N members, N rounds"). Nothing in
the circuit changes — `nullifierHash` is still `Poseidon(identityNullifier,
externalNullifier)` — only the on-chain SHA-256 preimage that produces
`externalNullifier` changes, in `compute_external_nullifier`.

Effect: within one cycle, a given identity now produces the **same**
`nullifierHash` regardless of which round they claim in. The existing
`DataKey::Nullifier(circle_id, nullifier_hash)` replay guard — unchanged —
then does the enforcement for free: a second claim attempt by that identity
anywhere in the same cycle collides with the stored key and reverts with
the existing `AlreadyClaimed` error. Once `cycle` advances, the hash changes
again and the identity becomes eligible for the new cycle.

- **No circuit changes.** No recompile, no new trusted setup, no vkey
  rotation, no redeploying existing circles' verification keys.
- **No new storage key.** Reuses the existing nullifier map as-is.
- Smallest possible diff: `compute_external_nullifier` takes `cycle` instead
  of `round`; `claim` computes `cycle = circle.round / circle.size` before
  calling it. Both `expected_external_nullifier` in tests and
  `compute_external_nullifier` change together.

### Option B — dual nullifier (round-scoped + cycle-scoped)

Keep today's round-scoped `externalNullifier`/`nullifierHash` for anti-replay
_within_ a round, and have the circuit emit a **second** public output,
`cycleNullifierHash = Poseidon(identityNullifier, cycleTag)`, checked against
a second, cycle-keyed storage map.

- Gives clean separation: round-scoped hash guards "don't submit this exact
  proof twice," cycle-scoped hash guards "don't claim twice this cycle" —
  independently tunable if those two concerns ever diverge.
- Costs: a circuit change (new public output/input), a new trusted-setup
  ceremony (which per `contracts/README.md` §Instance-storage archival /
  the setup script's own warning, obsoletes every existing circle's vkey),
  a second storage write per claim, and one more `Fr` public input to the
  pairing check (~cheap, but not free).

Given Option A reaches the same guarantee with zero circuit/ceremony churn,
Option B is only worth it if a future requirement needs round-level and
cycle-level replay protection to move independently. Not the case today.

### Privacy analysis

The property to preserve: **claiming doesn't reveal which member claimed.**

- **Within a cycle (Option A):** once an identity claims, its
  `nullifierHash` for that cycle is now on-chain permanently (as it already
  is per-round today) and blocks a second claim. `nullifierHash` is a
  Poseidon hash of a private `identityNullifier` — observing it reveals
  nothing about _which_ leaf in the Merkle tree it came from. This is the
  same leak profile as today, just widened from a 1-round window to an
  N-round (cycle) window: an observer learns "some member has already
  claimed this cycle," never who.
- **Across cycles:** `cycle` advances, so `externalNullifier` changes, so
  the same real identity produces an unlinkable new `nullifierHash` next
  cycle — identical unlinkability property to what round-to-round claims
  have today. Option A does not weaken cross-epoch unlinkability.
- **Timing side channel (both options, out of scope for this ADR):** if
  members coordinate turn order off-chain (e.g. "I'll claim round 2"), the
  _timing_ of a claim transaction could correlate with that off-chain
  schedule for an observer who already has side information. That's a
  social-layer concern the contract cannot fix by construction — same as
  today — and is unaffected by choosing A or B.

## Decision

Adopt **Option A** for the initial fix: cycle-scoped `externalNullifier`
(`cycle = round / size`), no circuit or trusted-setup changes. Revisit
Option B only if a concrete future requirement needs round-level and
cycle-level replay protection to be independently tunable.

### Storage Bounding

Under Option A, the `circle.nullifiers` set only needs to store one cycle's worth of nullifiers to prevent double-claiming within the cycle. When the cycle advances, all members receive fresh `externalNullifier`s anyway, making the old nullifier hashes irrelevant.

Therefore, we can safely clear the `circle.nullifiers` vector at cycle boundaries (e.g., when `round % size == 0`). This strictly bounds the maximum size of the `nullifiers` vector inside the `Circle` storage entry to exactly `size` elements, permanently resolving the unbounded growth issue (Issue #480).

## Consequences

- `Contract::compute_external_nullifier` takes `cycle: u32` instead of
  `round: u32`; `claim` computes `circle.round / circle.size` before calling
  it. `fund`/`pot_target` are untouched — funding logic doesn't change.
- `WrongRoundTag` becomes, precisely, "wrong cycle tag" — proofs must be
  fresh for the current cycle, not the current round. No rename needed for
  a first pass; a doc comment update on the error variant is enough.
- Existing circles keep working: `size` is already stored per circle, so
  `cycle` derives cleanly with no new field and no migration.
- Test coverage to add alongside implementation: same identity blocked on
  its second claim within a cycle (`AlreadyClaimed`), and successfully
  eligible again once `cycle` advances (round crosses a multiple of
  `size`).
- This ADR's verification test
  (`same_identity_can_claim_two_consecutive_rounds`) should be revisited
  once Option A lands — at that point the same scenario (same identity,
  round 0 then round 1, same cycle) should assert `AlreadyClaimed` instead
  of a second successful payout.
