# Contract coverage gaps

Measured baseline for `just coverage` / `cargo llvm-cov --fail-under-lines`
lives in [`coverage-thresholds.json`](../coverage-thresholds.json) (`contracts.lines`).

This file lists `panic_with_error!` arms in `sharibo/src/lib.rs` that the suite
does **not** currently exercise (or only exercises indirectly). Arms not listed
here are covered by an existing `#[should_panic]` / happy-path test.

## Known gaps (triage follow-up)

| Arm / path | Error | Why it matters | Suggested test |
|---|---|---|---|
| `expire_round` before deadline | `RoundNotExpired` (#12) | No SDK caller in client yet (#485); easy high-value panic | Advance ledger past / before deadline |
| `expire_round` when pot is full | `RoundFull` (#6) | Distinguishes expire vs claim | Fund to target then call expire |
| `expire_round` happy path | — | Refunds stuck contributors | Partial fund + expire after deadline |
| `propose_admin` / `accept_admin` | `CircleNotFound`, `CircleCancelled` | Admin rotation has no SDK caller | Propose → accept; cancel mid-transfer |
| `fund` after deadline | `RoundNotExpired` (#12) | Same code as expire guard | Set deadline, advance ledger, fund |
| `Overflow` in `pot_target` / `fund` pot add | `Overflow` (#7) | Absurd contribution × size | Extreme size/contribution fixtures |
| `apply_fee` with `fee_bps > MAX_FEE_BASIS_POINTS` | `InvalidFeeParams` (#9) | Internal guard (create already rejects); still worth a unit call | Direct `apply_fee` harness (proptest covers in-range) |

## Covered (do not regress)

`CircleNotFound`, `RoundNotFunded`, `WrongRoundTag`, `AlreadyClaimed`,
`InvalidProof`, `RoundFull` (on `fund`), `CircleCancelled`, `InvalidFeeParams`
(on `create_circle`), `InvalidCircleParams` (size / contribution / VK length),
`InvalidRecipient` (fee recipient / claim recipient = contract).

When closing a gap, delete its row here and consider raising the
`contracts.lines` floor by ~1–2 points.
