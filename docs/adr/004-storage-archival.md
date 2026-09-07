# ADR 004: Storage Archival and Nullifier Lifetime

- **Status:** Accepted
- **Date:** 2026-08-31
- **Context:** Design for issue #254 (Nullifier entries can be archived — a claim could be replayed after TTL expiry).

## Context

In Soroban, persistent storage entries are archived when their TTL lapses.

Previously, the double-claim fence in `Contract::claim` relied on standalone persistent storage entries:
```rust
let nullifier_key = DataKey::Nullifier(circle_id, nullifier_hash.clone());
if env.storage().persistent().has(&nullifier_key) {
    panic_with_error!(&env, Error::AlreadyClaimed);
}
```

Soroban persistent entries have their TTL extended at write time to `LEDGER_EXTEND_TO = 500_000` ledgers (~1 month at 5s/ledger). Nullifiers are write-once per claim and were never accessed or extended again.

In contrast, the `Circle` entry (`DataKey::Circle(circle_id)`) is continuously re-extended on every `fund` and `claim` call. If a circle remains active or is extended, but individual `DataKey::Nullifier` entries lapse and are archived, `env.storage().persistent().has(&nullifier_key)` would return `false`. This opened a vulnerability where a member could replay a previously used claim/nullifier in a subsequent round after its TTL expired.

## Options Analyzed

### Option (a) — Re-extend every circle's nullifier TTLs on each claim
- On every claim, iterate through all previously stored nullifiers for the circle and extend their TTLs.
- **Drawback**: Unbounded storage lookups and CPU/TTL extension work as the number of claims grows; fails to scale.

### Option (b) — Store nullifiers as a bounded `Vec<Fr>` inside the `Circle` struct (Chosen)
- Add `pub nullifiers: Vec<Fr>` to `pub struct Circle`.
- Read and check `circle.nullifiers.contains(&nullifier_hash)` directly within `claim` and `has_claimed`.
- Store nullifiers directly inside `Circle` at `DataKey::Circle(circle_id)`.
- **Advantages**:
  - Nullifiers inherit the `Circle` entry's continuously-extended TTL lifecycle. As long as the `Circle` entry is live or re-extended, all nullifiers registered for that circle remain live.
  - For a fixed-size ROSCA, the number of nullifiers in a circle is bounded by design (`size` members per cycle).
  - In-memory `Vec::contains()` on a small `soroban_sdk::Vec` is O(N) where N ≤ circle size, which is cheap and fits comfortably within CPU instruction limits.

### Option (c) — Declare circles time-bounded
- Require circles to complete within the 500,000 ledger TTL window and accept replay risks for expired circles.
- **Drawback**: Leaves residual vulnerability if a circle spans more than ~1 month.

## Decision

Adopt **Option (b)**. Nullifiers are embedded within `Circle.nullifiers`.

## Consequences

- Nullifiers never archive independently of the `Circle` entry.
- Double-claim fences survive arbitrary ledger advancement as long as the circle exists.
- State size per `Circle` increases by `32 * N` bytes, naturally bounded by circle size.

Every other persistent write in the contract (`Circle`) is re-extended on the *circle's* next `fund`/`claim`, so as long as a circle keeps getting used its entries never lapse. A `Nullifier` entry has no such second touch: nothing in `claim`, `fund`, or `has_claimed` ever extends an *existing* nullifier's TTL — it is written once, extended once (to `LEDGER_EXTEND_TO = 500_000` ledgers from that moment), and never referenced again unless the same `nullifier_hash` is presented a second time.

**Replay risk.** If that second presentation happens after the entry's TTL has lapsed and nobody has restored it, `env.storage().persistent().has(&nullifier_key)` reads the archived, un-restored key as absent — the same fallback-to-default behaviour documented for `NextCircleId` above — and the `AlreadyClaimed` check silently passes. A member who claimed once could claim again in a later round of the same circle, defeating the exact fence the entry exists to enforce. This is tracked separately as issue #254, because unlike `Circle`/`NextCircleId` (which fail closed, or require the whole contract to go quiet), the nullifier case fails *open* and only requires one circle's one nullifier to sit untouched for one TTL window — a far more plausible scenario for a circle that finished its rounds and was never revisited.

**Why nullifiers alone have this shape.** `Circle` entries are read and rewritten on every `fund`/`claim` for that circle, so their TTL rides along for free. A nullifier is deliberately write-once — it exists purely to remember that one specific claim happened — so there is no natural second write to piggyback a TTL extension onto, unlike the circle it belongs to.

## Decision

1. **Accept the residual risk for now, bounded by a concrete operational window**, rather than block this document on a fix: a nullifier remains a reliable fence for at least `LEDGER_EXTEND_TO` ledgers (~29 days, at `500_000 ledgers × ~5s average close time ≈ 2.5M s`) after the claim that wrote it, and archival requires that specific key to go completely untouched — no restore, no repeat claim attempt with that nullifier — for the entire window.
2. **The fix belongs to issue #254, not this ADR.** That issue lays out three options: (a) re-extend every nullifier on every claim to the same circle — unbounded work, doesn't scale with round count; (b) fold nullifiers into a bounded `Vec` on the `Circle` entry itself (at most `size` entries for a fixed-size ROSCA) so they inherit the circle's continuously-refreshed TTL for free; (c) declare circles time-bounded and document that a circle must fully complete (all `size` claims) inside one `LEDGER_EXTEND_TO` window. **This ADR recommends option (b)**: it removes the write-once TTL gap entirely instead of working around it, and the bound (`size` members) already exists as a circle parameter, so the `Vec` cannot grow unbounded. Implementation and the ledger-advancement test proving the fence survives TTL expiry are #254's scope, not this document's.
3. **Until #254 lands**, treat "a circle whose current round hasn't turned over within ~29 days of its last claim" as outside the trust boundary for operational monitoring: a claimed-but-dormant round is exactly the window where a replay becomes possible, and ops should flag circles that have gone quiet that long.

## Consequences

- `NextCircleId` and `Circle` entries fail closed under archival (a stuck call, not a security hole) — no action needed beyond what's already implemented for instance-TTL extension (issue #84).
- The `Nullifier` archival gap is a known, accepted, time-bounded risk until #254 ships. This ADR must be revisited once #254's fix lands — the Decision section above should then describe the shipped bounded-`Vec` design instead of the residual-risk acceptance.
- Any future `DataKey` variant must state, in its own doc comment and in the table above, whether something re-extends it. A write-once entry with no natural companion write needs the same explicit accept-or-fix decision the nullifier case got here.
