# Sharibo Error Codes

All contract errors are defined as `#[contracterror]` variants in
`contracts/sharibo/src/lib.rs`. The client SDK parses `Error(Contract, #N)`
strings from Stellar RPC failures and maps them to typed subclasses in
`packages/client/src/errors.ts` via `packages/client/src/decodeError.ts`.

## Error code table

| Code | Enum variant          | TypeScript class          | Meaning                                                              |
| ---- | --------------------- | ------------------------- | -------------------------------------------------------------------- |
| 1    | `CircleNotFound`      | `CircleNotFoundError`     | No circle is stored at the requested `circle_id`.                    |
| 2    | `RoundNotFunded`      | `RoundNotFundedError`     | `claim` was called before the pot reached `contribution × size`.     |
| 3    | `WrongRoundTag`       | `WrongRoundTagError`      | Proof's `external_nullifier` does not match `hash(circle_id, round)` |
| 4    | `AlreadyClaimed`      | `AlreadyClaimedError`     | This nullifier was already used in a prior claim for this circle.    |
| 5    | `InvalidProof`        | `InvalidProofError`       | Groth16 pairing check returned false.                                |
| 6    | `RoundFull`           | `RoundFullError`          | Pot is already at `contribution × size`; no more funds accepted.     |
| 7    | `Overflow`            | `OverflowError`           | Checked pot arithmetic overflowed (absurd contribution / size).       |
| 8    | `CircleCancelled`     | `CircleCancelledError`    | `cancel_circle` or `fund`/`claim` called on a cancelled circle.     |
| 9    | `InvalidFeeParams`    | — (generic `ContractError`) | `create_circle` rejected a `fee_bps` outside `0..=10_000`.         |

All subclasses extend `ContractError`, which in turn extends `ShariboError`.

## How decoding works

1. The Stellar SDK surfaces contract panics as opaque messages containing
   `Error(Contract, #N)`, either during simulation or submission.
2. `decodeContractError()` in `packages/client/src/decodeError.ts` walks the
   error's cause chain, extracts the numeric code via regex, and instantiates
   the corresponding typed subclass — preserving the original error as
   `cause`.
3. Every public function in `packages/client/src/contract.ts` wraps both the
   simulation call (`withRetry`) and the submission (`signAndSend()`) in a
   `try/catch` that feeds through `decodeContractError()`.
4. Transient RPC failures (429, 5xx) are retried with exponential backoff
   before being wrapped in `RpcError`.

## Usage

```ts
import {
  claim,
  AlreadyClaimedError,
  InvalidProofError,
} from "@sharibo/client";

try {
  await claim(client, { ... });
} catch (e) {
  if (e instanceof AlreadyClaimedError) {
    console.log("Double-claim — show round-next UI");
  } else if (e instanceof InvalidProofError) {
    console.log("Proof invalid — ask user to regenerate");
  } else {
    // Generic error handling
    console.error(e);
  }
}
```

## Keeping in sync

When adding a new `#[contracterror]` variant in
`contracts/sharibo/src/lib.rs`:

1. Add the variant to the `Error` enum in `lib.rs`.
2. Add a matching subclass in `packages/client/src/errors.ts`.
3. Add a case to `createContractError()` in `packages/client/src/decodeError.ts`.
4. Add a user-facing message to `toUiError()` in `app/src/App.tsx`.
5. Add a row to this table.
