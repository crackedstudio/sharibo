/**
 * Sharibo SDK error classes.
 *
 * See docs/errors.md for the full mapping between on-chain contract error
 * codes, these classes, user-facing messages, likely causes, and remedies.
 *
 * ## Class hierarchy
 *
 * ```
 * ShariboError
 * ├── ContractError      — on-chain revert; .code matches docs/errors.md table
 * ├── InvalidInputError  — bad argument caught client-side before any RPC call
 * ├── ProvingError       — snarkjs / witness generation failure
 * └── RpcError           — network or RPC transport failure
 * ```
 */

export class ShariboError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidInputError extends ShariboError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class ProvingError extends ShariboError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class RpcError extends ShariboError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * Thrown when the Soroban contract reverts with a typed error code.
 *
 * `code` matches the discriminant of `pub enum Error` in
 * `contracts/sharibo/src/lib.rs`. Use the constants below for readable
 * comparisons. Full semantics for each code are in `docs/errors.md`.
 *
 * @example
 * ```ts
 * import { ContractError, ErrorCode } from "@sharibo/client";
 *
 * try {
 *   await claim(client, args);
 * } catch (err) {
 *   if (err instanceof ContractError) {
 *     if (err.code === ErrorCode.AlreadyClaimed) { ... }
 *   }
 * }
 * ```
 */
export class ContractError extends ShariboError {
  readonly code?: number;

  constructor(message: string, code?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

/**
 * Numeric constants for every `Error` variant in the contract.
 *
 * These mirror the `#[repr(u32)]` discriminants in `pub enum Error` in
 * `contracts/sharibo/src/lib.rs`. The count is guarded by the Rust test
 * `error_table_variant_count` — adding a variant without updating that test
 * and this object will cause a test failure.
 *
 * See `docs/errors.md` for the full description of each code.
 */
export const ErrorCode = {
  /** `circle_id` does not exist in persistent storage. */
  CircleNotFound: 1,
  /** `claim` called before the pot reached `contribution × size`. */
  RoundNotFunded: 2,
  /** `external_nullifier` did not match `SHA256(circle_id, round) mod r`. */
  WrongRoundTag: 3,
  /** `nullifier_hash` was already recorded by a prior successful claim. */
  AlreadyClaimed: 4,
  /** Groth16 pairing check returned false. */
  InvalidProof: 5,
  /** `fund` called after the pot is already at `contribution × size`. */
  RoundFull: 6,
  /** `contribution × size` or `pot + contribution` overflowed `i128`. */
  Overflow: 7,
  /** Circle was permanently closed by `cancel_circle`. */
  CircleCancelled: 8,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
