# Sharibo Error Codes

All contract errors are defined as `#[contracterror]` variants in
`contracts/sharibo/src/lib.rs`. The client SDK parses `Error(Contract, #N)`
strings from Stellar RPC failures and maps them to typed subclasses in
`packages/client/src/errors.ts` via `packages/client/src/decodeError.ts`.

## Error code table

| Code | Enum variant          | TypeScript class            | Meaning                                                                                                                                                       |
| ---- | --------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `CircleNotFound`      | `CircleNotFoundError`       | No circle is stored at the requested `circle_id`.                                                                                                             |
| 2    | `RoundNotFunded`      | `RoundNotFundedError`       | `claim` was called before the pot reached `contribution × size`.                                                                                              |
| 3    | `WrongRoundTag`       | `WrongRoundTagError`        | Proof's `external_nullifier` does not match `hash(circle_id, round)`                                                                                          |
| 4    | `AlreadyClaimed`      | `AlreadyClaimedError`       | This nullifier was already used in a prior claim for this circle.                                                                                             |
| 5    | `InvalidProof`        | `InvalidProofError`         | Groth16 pairing check returned false.                                                                                                                         |
| 6    | `RoundFull`           | `RoundFullError`            | Pot is already at `contribution × size`; no more funds accepted.                                                                                              |
| 7    | `Overflow`            | `OverflowError`             | Checked pot arithmetic overflowed (absurd contribution / size).                                                                                               |
| 8    | `CircleCancelled`     | `CircleCancelledError`      | `cancel_circle` or `fund`/`claim` called on a cancelled circle.                                                                                               |
| 9    | `InvalidFeeParams`    | — (generic `ContractError`) | `create_circle` rejected a `fee_bps` outside `0..=10_000`.                                                                                                    |
| 10   | `InvalidCircleParams` | `InvalidCircleParamsError`  | `create_circle` rejected size / contribution / `vk.ic` shape. Prefer client-side `validateContributionAmount` so the UI names the cause before a fee is paid. |

## `CircleNotFound` coverage

Every entrypoint that reads or writes a circle by id reverts with
`CircleNotFound` (`Error(Contract, #1)`) when no circle is stored at the
requested `circle_id`:

- `create_circle` — never (it _creates_ the circle).
- `fund`, `claim`, `cancel_circle`, `propose_admin`, `accept_admin`,
  `expire_round` — state-changing entrypoints that load the circle first.
- `get_circle`, `get_circle_meta`, `get_vk`, `get_round`, `get_pot`,
  `get_status`, `get_contributors` — read entrypoints.
- `get_circle_count`, `has_claimed` — never (they tolerate unknown ids by
  design: the count is instance-level, and `has_claimed` returns `false`).

On the SDK side all of these surface as `CircleNotFoundError` via
`decodeContractError()`, including the new `getVk` read.

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
   before being wrapped in `RpcError`. Defaults: 3 retries, 500ms base delay,
   worst-case sleep ~3.5s (`DEFAULT_RETRY_POLICY`). Callers can override per
   client or per call; see `packages/client/README.md` §Retries and observability.

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

## Amounts

`xlmToStroops` (in `packages/client/src/amount.ts`) converts an XLM amount to
stroops (1 XLM = 10,000,000 stroops).

**Rounding rule: truncation toward zero.** Sub-stroop precision is discarded,
never rounded up. `xlmToStroops("0.00000009")` is `0n`, not `1n`. This is the
safer default for a deposit amount — a user is never charged more than they
typed. The `claim` side requires `pot == contribution × size` exactly, so a
one-stroop discrepancy would make a round unclaimable.

`xlmToStroops` accepts `bigint | string`. A `number` is rejected with a
`TypeError`: a JS `number` cannot represent stroop-precision decimals beyond
~15 significant digits, and `Number.prototype.toString()` emits exponent
notation below `1e-6` (e.g. `1e-7`), which would silently lose precision or
throw. Pass a string (or `bigint`) instead.

## Keeping in sync

When adding a new `#[contracterror]` variant in
`contracts/sharibo/src/lib.rs`:

1. Add the variant to the `Error` enum in `lib.rs`.
2. Add a matching subclass in `packages/client/src/errors.ts`.
3. Add a case to `createContractError()` in `packages/client/src/decodeError.ts`.
4. Add a user-facing message to `toUiError()` in `app/src/App.tsx`.
5. Add a row to this table.
