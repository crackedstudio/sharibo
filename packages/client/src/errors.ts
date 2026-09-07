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

// ── Typed contract-error subclasses (error codes 1..8) ──────────────────────
// Each mirrors a `#[contracterror]` variant in contracts/sharibo/src/lib.rs.
// Callers can use `instanceof` to branch on the specific failure reason
// without parsing XDR dumps.

/** #1 – No Circle is stored at the requested circle_id. */
export class CircleNotFoundError extends ContractError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 1, options);
  }
}

/** #2 – Claim called before the pot reached contribution * size. */
export class RoundNotFundedError extends ContractError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 2, options);
  }
}

/** #3 – Proof's external_nullifier did not match hash(circle_id, round). */
export class WrongRoundTagError extends ContractError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 3, options);
  }
}

/** #4 – Nullifier has already been used in a prior claim for this circle. */
export class AlreadyClaimedError extends ContractError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 4, options);
  }
}

/** #5 – Groth16 pairing check returned false. */
export class InvalidProofError extends ContractError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 5, options);
  }
}

/** #6 – The round pot is already full; further funds would brick claim. */
export class RoundFullError extends ContractError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 6, options);
  }
}

/** #7 – Checked pot arithmetic overflowed. */
export class OverflowError extends ContractError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 7, options);
  }
}

/** #8 – cancel_circle or fund/claim called on a cancelled circle. */
export class CircleCancelledError extends ContractError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 8, options);
  }
}


// ── Contract-rejection prose (issue #53) ─────────────────────────────────────

/** A human-readable description of a contract rejection code. */
export interface ContractErrorDescription {
  code: number;
  name: string;
  /** One user-facing sentence explaining what went wrong. */
  message: string;
  /** What the caller can do about it. */
  hint: string;
}

// Scoped to the discriminants issue #53 covers; codes outside this table fall
// back to the raw error message rather than inventing prose for them.
const CONTRACT_ERROR_DESCRIPTIONS: Record<number, ContractErrorDescription> = {
  1: {
    code: 1,
    name: "CircleNotFound",
    message: "No circle exists at that id on this network.",
    hint: "Check the circle id, and that you are pointed at the network it was created on.",
  },
  2: {
    code: 2,
    name: "RoundNotFunded",
    message: "This round is not fully funded yet, so it cannot be claimed.",
    hint: "Wait until every member has funded the current round, then claim again.",
  },
  3: {
    code: 3,
    name: "WrongRoundTag",
    message: "The proof is bound to a different round than the circle's current one.",
    hint: "Regenerate the proof against the current round and resubmit.",
  },
  4: {
    code: 4,
    name: "AlreadyClaimed",
    message: "This proof's nullifier was already used, so the payout is already spent.",
    hint: "Each identity can claim once per round — wait for the next round.",
  },
  5: {
    code: 5,
    name: "InvalidProof",
    message: "The zero-knowledge proof failed on-chain verification.",
    hint: "Regenerate the proof with the current circuit artifacts and verification key.",
  },
};

/** Look up the prose for a contract rejection code, or `undefined` if unknown. */
export function describeContractError(code: number): ContractErrorDescription | undefined {
  return CONTRACT_ERROR_DESCRIPTIONS[code];
}

// The shape @stellar/stellar-sdk surfaces for a contract rejection, matching
// contract/utils.js's own `contractErrorPattern`.
const CONTRACT_ERROR_PATTERN = /Error\(Contract, #(\d+)\)/;

/**
 * Extract the contract rejection code from whatever was thrown, or
 * `undefined` if it is not a contract rejection.
 */
export function parseContractErrorCode(err: unknown): number | undefined {
  if (err instanceof ContractError && typeof err.code === "number") return err.code;
  if (!(err instanceof Error)) return undefined;
  const match = CONTRACT_ERROR_PATTERN.exec(err.message);
  return match ? Number(match[1]) : undefined;
}

/**
 * Render a thrown value as user-facing text: known contract rejections become
 * "Name: sentence hint" prose, everything else falls back to its own message.
 */
export function describeError(err: unknown): string {
  const code = parseContractErrorCode(err);
  if (code !== undefined) {
    const description = describeContractError(code);
    if (description) return `${description.name}: ${description.message} ${description.hint}`;
  }
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Something went wrong. Please retry.";
}
