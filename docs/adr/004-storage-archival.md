# ADR 004: Storage Archival and Nullifier Lifetime

- **Status:** Accepted (updated 2026-09-28 for issue #565)
- **Date:** 2026-08-31
- **Context:** Design for issue #254 (Nullifier entries can be archived — a claim could be replayed after TTL expiry). Option (b) shipped; this revision documents the TTL constants against live network limits and the `round_deadline_ledgers` interaction.

## Context

In Soroban, persistent storage entries are archived when their TTL lapses.
Nullifiers used to live as standalone `DataKey::Nullifier` entries that were
write-once and never re-extended. The `Circle` entry is continuously
re-extended on every write, so a dormant nullifier could archive while the
circle stayed live — failing _open_ on the double-claim fence.

## Decision

Adopt **Option (b)**. Nullifiers are embedded within `Circle.nullifiers` and
inherit the Circle entry's continuously-extended TTL. The standalone
`DataKey::Nullifier` path is gone.

## TTL constants (issue #565)

Values live in `contracts/sharibo/src/lib.rs`. Wall-clock assumes ~5 s/ledger.

| Constant                             | Value                                                       | Wall-clock  | If network ceiling is lower                                                                                                          | If the value is raised                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `LEDGER_THRESHOLD`                   | 100 ledgers                                                 | ≈ 8 minutes | N/A (threshold, not a target)                                                                                                        | Entries are refreshed less often near expiry; more risk of racing archival on quiet paths                                |
| `LEDGER_EXTEND_TO`                   | 500,000 ledgers                                             | ≈ 29 days   | Every `extend_ttl` **silently clamps** to `max_entry_ttl`; the contract assumes a longer life than the network grants, with no error | Approaches / exceeds `max_entry_ttl` (currently documented **535,679**); clamp risk, and longer dormancy before archival |
| `max_entry_ttl` (network)            | **535,679** ledgers (testnet & mainnet, as of 2026-09 docs) | ≈ 31 days   | Network-controlled — re-check before mainnet                                                                                         | N/A (network setting)                                                                                                    |
| `min_persistent_entry_ttl` (network) | **4,096** ledgers (typical)                                 | ≈ 5.7 hours | New persistent writes get a shorter default floor                                                                                    | N/A (network setting)                                                                                                    |

Re-check live network settings with Horizon / `stellar network settings`
(mainnet: `https://horizon.stellar.org/`, testnet:
`https://horizon-testnet.stellar.org/`) or the
[extend-contract-wasm cookbook](https://developers.stellar.org/docs/tools/cli/cookbook/extend-contract-wasm).

### `round_deadline_ledgers` interaction

A circle whose round deadline exceeds `LEDGER_EXTEND_TO` could archive its
`Circle` entry before `expire_round` becomes callable — bricking the recovery
path from #258 exactly when it is needed. `create_circle` therefore rejects
`round_deadline_ledgers >= LEDGER_EXTEND_TO` (`0` still means "no deadline").

### Nullifier fence

Because nullifiers live inside `Circle`, advancing the ledger past
`LEDGER_EXTEND_TO` and then touching the circle (e.g. funding the next round)
re-extends the whole entry — including every recorded nullifier. The
`nullifier_fence_survives_ttl_expiry` test advances by `LEDGER_EXTEND_TO + 10`,
not merely `LEDGER_THRESHOLD`.

## Consequences

- Nullifiers never archive independently of the `Circle` entry.
- Double-claim fences survive arbitrary ledger advancement as long as the
  circle exists and is restored if archived.
- State size per `Circle` increases by `32 * N` bytes, bounded by circle size.
- Instance storage is extended on every write path (including
  `cancel_circle`, `propose_admin`, `accept_admin`) so `NextCircleId` cannot
  reset under quiet periods (#84).
