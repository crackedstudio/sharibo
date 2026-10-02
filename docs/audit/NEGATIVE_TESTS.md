# Negative-test inventory (audit prep)

Tests that reject bad witnesses, bad public inputs, or bad encodings — plus **known gaps** where adversarial behavior is not yet covered by an automated test.

## Circuits — `circuits/test/membership.test.js`

| Case                                                                          | Expected                                            | Covered                                 |
| ----------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------- |
| Valid member + correct `nullifierHash`                                        | Witness succeeds                                    | Yes                                     |
| Wrong Merkle root                                                             | Witness failure                                     | Yes                                     |
| Tampered `pathElements`                                                       | Witness failure                                     | Yes                                     |
| Non-boolean `pathIndices`                                                     | Witness failure                                     | Yes                                     |
| Nullifier determinism (same/different round)                                  | Hash pinned                                         | Yes                                     |
| Public signal order `[nullifierHash, root, externalNullifier, recipientHash]` | Positions pinned                                    | Yes                                     |
| `recipientHash` changed in witness                                            | Still satisfies circuit (binding enforced on-chain) | Yes (documents contract responsibility) |

**Gaps**

- No dedicated test for **out-of-range field elements** in private inputs at circuit level (client validates in `validateCircuitInput`; circuit may reduce mod field silently depending on template — verify during audit).
- No test for **maximum field boundary** values on `externalNullifier` / `recipientHash` at circuit boundary.

## Contract — `contracts/sharibo/src/test.rs`

| Case                                      | Expected               | Covered         |
| ----------------------------------------- | ---------------------- | --------------- |
| Underfunded pot                           | `RoundNotFunded`       | Yes             |
| Nullifier reuse                           | `AlreadyClaimed`       | Yes             |
| Wrong round tag                           | `WrongRoundTag`        | Yes             |
| Tampered `nullifier_hash` (pairing fails) | `InvalidProof`         | Yes             |
| Real proof happy path                     | Success                | Yes             |
| CPU budget for `claim`                    | < 80M instructions     | Yes             |
| `fund` / `create_circle` auth             | `require_auth`         | Yes             |
| Fee deduction / zero fee                  | Balances               | Yes             |
| Invalid fee params at create              | Revert                 | Yes             |
| Contract as fee recipient                 | Revert                 | Yes             |
| VK `ic` length mismatch                   | `verify_groth16` false | Yes (synthetic) |

**Gaps**

- **Recipient-binding rejection:** No `#[should_panic]` test that submits a valid proof fixture with a **different** `recipient` address than the proof's `recipientHash` (expected `InvalidProof`). Behavior is implied by ADR 006 and public-input binding; add test before mainnet.
- **Field-boundary external nullifier:** No test with externally supplied `external_nullifier` at \(2^{256}-1\) or non-canonical bytes beyond wrong-tag cases.
- **Out-of-range path elements:** Not applicable on-chain (path is private); covered only indirectly via circuit tests.
- Hostile / fee-on-transfer token | Partially documented in `Circle` doc comment; limited automated hostile-token test (#317 open).

## Client — `packages/client/src/prove.test.ts`, `packages/core/src/identity.test.ts`

| Case                                            | Expected            | Covered                |
| ----------------------------------------------- | ------------------- | ---------------------- |
| `pathElements` length mismatch vs depth         | `InvalidInputError` | Yes                    |
| `pathIndices` not 0/1                           | `InvalidInputError` | Yes                    |
| Negative / ≥ modulus field elements             | `InvalidInputError` | Yes                    |
| `circleId` / `round` out of u64/u32 range (#65) | `InvalidInputError` | Yes (identity.test.ts) |

**Gaps**

- End-to-end test that **wrong recipient hash** fails local verify or on-chain claim (needs proof generated with explicit `recipientHash`).
- **`CircuitInput` / `generateProof`** — confirm `recipientHash` is always passed into snarkjs when proving (wire-format invariant); audit should trace call sites in `scripts/e2e.ts` and app.

## Cross-implementation

| Case               | Location                                              | Covered |
| ------------------ | ----------------------------------------------------- | ------- |
| Poseidon vectors   | `test-vectors/poseidon.json`, client + circuit checks | Yes     |
| Merkle path parity | `packages/core/src/tree.test.ts`                      | Yes     |

**Gaps**

- **Recipient hash bytes:** Contract hashes Address **XDR**; client hashes **StrKey-decoded 32-byte key** — alignment for all Stellar address types not exhaustively tested (flag in [wire-format.md](../wire-format.md)).

## Recommended additions before production

1. Contract: `claim_reverts_when_recipient_hash_mismatch` with committed fixture proof.
2. Client: prove + local verify with wrong `recipientHash` in circuit input.
3. Circuit or client: boundary tests for `externalNullifier` at field modulus edges.
4. Execute multi-party ceremony (#546) and document attestations — not a unit test, but a prerequisite for Groth16 trust assumptions.
