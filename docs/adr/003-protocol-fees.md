# ADR 003: Protocol fees

- **Status:** Accepted (supersedes the 2026-08-31 "not shipping" decision that
  removed `apply_fee`)
- **Date:** 2026-09-04
- **Context:** Issues #251 (removal) and #252 (shipping). The fee mechanism
  is now a shipped, load-bearing part of the contract, so the previous
  decision to delete the unreferenced `apply_fee` utility is superseded by a
  concrete product design.

## Context

Issue #251 removed `apply_fee` because it was dead code with no fee-recipient
model. Issue #252 decided the opposite direction: **ship a protocol fee**,
but the earlier ADR's objections must be answered first — who owns
`fee_bps`/`fee_recipient`, whether the fee is mutable after creation, and
what happens to existing on-chain circles when `Circle`'s layout changes.

## Decision drivers

### Who owns the fee?

The circle admin. The admin already commits `root`, `contribution`, `size`,
`vk` and a deadline at `create_circle`; fee parameters are committed the same
way, in the same call, by the same actor. There is no protocol-wide constant
and no governance — a circle is an admin-created standalone instrument, so
the fee belongs to the instrument, not to a global policy table. The fee is a
basis-point rate (`fee_bps`) and a payout address (`fee_recipient`), both
stored *on the circle* and readable via `get_circle` before a member funds —
so the fee is visible up front, never discovered after a win.

### Mutable or immutable?

**Immutable.** `create_circle` validates the fee and writes both fields into
the `Circle` entry once; there is no setter and no entrypoint that can change
them later (`fee_is_immutable_after_creation` pins this). This avoids a
front-running class where an admin adjusts the fee between funding and claim,
and keeps the fee axiomatically stable for the whole lifecycle. The
consequence is that `Circle`'s layout changes — see *Consequences* for the
migration story.

### Validation

- `fee_bps <= 10_000` (`MAX_FEE_BASIS_POINTS`). Out of range reverts with
  `Error::InvalidFeeParams` (`#9`, previously reserved for exactly this).
- When `fee_bps > 0`, `fee_recipient` must not be the contract itself —
  a self-transfer would strand fee funds with no accounting. This reuses the
  `Error::InvalidRecipient` (`#11`) guard already used by `claim`.
- `fee_bps = 0` is the "no fee" default: `apply_fee` returns `(0, amount)`
  and `claim` skips the fee transfer entirely, performing the same single
  payout transfer (and the same CPU cost) as a pre-fee circle.

### `apply_fee` math

The split must be overflow-safe on `i128` amounts and lossless. Using
`q = amount / 10_000` and `r = amount % 10_000`:

```
fee = q * fee_bps + (r * fee_bps) / 10_000
net = amount - fee
```

This keeps every intermediate below `amount * 2` and pins `fee + net ==
amount`, which a restored proptest (`mod proptest_apply_fee`) asserts across
`fee_bps in 0..=10_000` and `amount in 0..=i128::MAX/2`.

## Decision

**Ship protocol fees, committed immutably at `create_circle`.**

1. `Circle` gains `fee_bps: u32` and `fee_recipient: Address`; the struct's
   `schema_version` is bumped to `2`.
2. `create_circle` gains `fee_bps` and `fee_recipient` parameters, validated
   per the rules above.
3. `apply_fee` is restored as a free function (see *Context* for the math).
4. `claim` splits the pot:

   - `let (fee, net) = apply_fee(&env, circle.fee_bps, payout);`
   - transfers `fee` to `circle.fee_recipient` — **skipped entirely when
     `fee == 0`**;
   - transfers `net` to `recipient`.

5. The `claimed` event is unchanged (pays out the full pot and the recipient).
   The fee is deliberately not a second event: it is derivable from
   `fee_bps` and the pot, and adding an event would be the contract's first
   event-schema decision for marginal benefit. Fee recipients are readable
   via `get_circle`.
6. SDK (`createCircle` args, `CircleView`) and the app (pot summary shows the
   fee before a member funds) surface the new fields.

## Consequences

- **Schema break, testnet reset required.** `Circle` is a `#[contracttype]`
  struct written to persistent storage. Adding fields changes its XDR
  layout; per **ADR 001** there is no upgrade or migration path. `schema_version`
  is bumped `1 → 2`, and any testnet circles created under the old schema
  must be cancelled/reset. The contract achieves its first schema bump;
  future struct changes need a fresh reset and ADR note.
- `contracts/sharibo/src/lib.rs`: `apply_fee` restored with its
  overflow-safe split and rustdoc; `create_circle`/`claim` updated;
  `MAX_FEE_BASIS_POINTS = 10_000` introduced.
- `contracts/sharibo/src/test.rs`:
  - `mod proptest_apply_fee` restored (`fee_plus_net_equals_amount`).
  - Deterministic `apply_fee` tests (zero bps, full bps, truncation,
    out-of-range panic).
  - `create_circle` validation tests: `#9` reject on `10_001`, `#11` reject
    on contract-as-fee-recipient, max-bps acceptance.
  - `fee_is_immutable_after_creation` (no setter exists).
  - Claim-level fee tests (`claim_deducts_fee_and_sends_to_fee_recipient`,
    `claim_skips_fee_transfer_when_fee_bps_zero`) are marked
    `#[ignore]` until the ZK trusted-setup fixture is regenerated
    (**ADR 006** / #275): every claim-success test on `main` currently fails
    `InvalidProof` against the stale pre-recipientHash fixture. They run and
    assert the full payout path once that fixture lands.
- `docs/errors.md` gains a row for `InvalidFeeParams` (`#9`), now reachable.
- `contracts/README.md`: `create_circle` signature and `claim` description
  updated.
- A `fee_bps = 0` circle behaves exactly as before the fee shipped,
  including CPU cost of `claim`.