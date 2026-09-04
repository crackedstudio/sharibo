# Sharibo Error Code Reference

This is the canonical mapping between on-chain contract error codes, the Rust
`Error` enum variants, the TypeScript SDK classes, and the user-facing meaning.

**Maintenance rule:** a Rust test (`error_table_variant_count`) in
`contracts/sharibo/src/test.rs` asserts that the number of `Error` variants
equals `DOCUMENTED_ERROR_COUNT`. Adding a ninth variant to the contract will
fail that test until you:

1. Add a row to the table below.
2. Bump `DOCUMENTED_ERROR_COUNT` in `test.rs`.
3. Add or extend an SDK class in `packages/client/src/errors.ts` if the new
   code needs its own user-facing treatment.
4. Update `contracts/README.md` §5 to reference this file.

---

## Error table

| Code | Contract variant | Raised by | SDK class | User-facing message | Likely cause | What the user should do |
|:---:|---|---|---|---|---|---|
| **1** | `CircleNotFound` | `load_circle` (via `fund`, `claim`, `get_circle`, `cancel_circle`) | `ContractError` (code 1) | "Circle not found." | The `circle_id` passed to the call does not exist in persistent storage. | Verify the circle ID is correct. Use `get_circle_count` to check how many circles have been created. |
| **2** | `RoundNotFunded` | `claim` | `ContractError` (code 2) | "Round not yet fully funded." | `claim` was called before every member of the current round has called `fund`. The pot must equal `contribution × size` exactly. | Wait for all members to fund, then retry. |
| **3** | `WrongRoundTag` | `claim` | `ContractError` (code 3) | "Proof is for a different round." | The `external_nullifier` in the submitted proof was computed for a different `(circle_id, round)` pair than the circle's current round. Common causes: stale proof from a previous round, or the round advanced between proof generation and submission. | Regenerate the proof for the current round. Call `get_circle` to read the current `round` value before generating. |
| **4** | `AlreadyClaimed` | `claim` | `ContractError` (code 4) | "This identity has already claimed in this circle." | The `nullifier_hash` presented was already recorded by a prior successful `claim` call. Each identity may claim at most once per circle (across all rounds). | Do not reuse a spent nullifier. If a new round starts, the same identity may claim again only if they generate a fresh proof bound to the new round's `external_nullifier`. |
| **5** | `InvalidProof` | `claim` | `ContractError` (code 5) | "ZK proof verification failed." | The Groth16 pairing check returned false. Possible causes: wrong `vk`, wrong public inputs (`nullifier_hash`, `root`, `external_nullifier` in wrong order or wrong values), corrupted proof bytes, or proof generated against a different circuit. | Regenerate the proof using the correct identity secret, Merkle path, root, and external nullifier. Confirm the `vk` stored in the circle matches the one used during proving. |
| **6** | `RoundFull` | `fund` | `ContractError` (code 6) | "This round is already fully funded." | `fund` was called after the pot already reached `contribution × size`. Further deposits are blocked to prevent the pot from exceeding the exact target that `claim` checks. | Wait for `claim` to be submitted and the round to advance, then fund the next round. |
| **7** | `Overflow` | `fund`, `claim` (via `pot_target`) | `ContractError` (code 7) | "Arithmetic overflow computing pot target." | `contribution × size` or `pot + contribution` overflowed `i128`. This requires absurdly large values (≥ 2¹²⁷ stroops) and indicates a misconfigured circle. | Do not create circles with contribution or size values that overflow a signed 128-bit integer when multiplied together. |
| **8** | `CircleCancelled` | `load_active_circle` (via `fund`, `claim`, `cancel_circle`) | `ContractError` (code 8) | "This circle has been cancelled." | The circle was permanently closed by `cancel_circle`. All current-round contributors were refunded at that time. | Do not interact with a cancelled circle. Start a new circle if needed. |

---

## SDK error class hierarchy

```
ShariboError
├── ContractError      — on-chain revert; carries .code matching the table above
├── InvalidInputError  — bad argument caught client-side before any RPC call
├── ProvingError       — snarkjs / witness generation failure
└── RpcError           — network or RPC transport failure
```

`ContractError` is thrown for all eight codes above. Callers that need to handle
a specific code should check `err.code`:

```ts
import { ContractError } from "@sharibo/client";

try {
  await claim(client, args);
} catch (err) {
  if (err instanceof ContractError) {
    switch (err.code) {
      case 1: /* CircleNotFound  */ break;
      case 2: /* RoundNotFunded  */ break;
      case 3: /* WrongRoundTag   */ break;
      case 4: /* AlreadyClaimed  */ break;
      case 5: /* InvalidProof    */ break;
      case 6: /* RoundFull       */ break;
      case 7: /* Overflow        */ break;
      case 8: /* CircleCancelled */ break;
    }
  }
}
```

---

## References

- Contract source: `contracts/sharibo/src/lib.rs` — `pub enum Error`
- SDK classes: `packages/client/src/errors.ts`
- Variant-count guard test: `contracts/sharibo/src/test.rs` — `error_table_variant_count`
- Contract README: `contracts/README.md` §5 Error Code Reference
