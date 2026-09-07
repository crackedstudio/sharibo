/**
 * Decode Stellar contract error codes from RPC failure messages and wrap them
 * in the corresponding typed error subclass.
 *
 * The Stellar SDK surfaces contract panics as opaque messages containing
 * `Error(Contract, #N)` — either during simulation (`.simulate()`) or
 * submission (`.sendAndSend()`). This module extracts the numeric code and
 * maps it to the matching `ContractError` subclass defined in `errors.ts`,
 * preserving the original error as `cause` for debugging.
 *
 * Everything that doesn't match the `Error(Contract, #N)` pattern is wrapped
 * in `RpcError` so callers can always `instanceof`-check against the SDK's
 * output.
 */

import {
  ContractError,
  CircleNotFoundError,
  RoundNotFundedError,
  WrongRoundTagError,
  AlreadyClaimedError,
  InvalidProofError,
  RoundFullError,
  OverflowError,
  CircleCancelledError,
  RpcError,
} from "./errors.js";

/**
 * Regex that captures the numeric code from `Error(Contract, #N)` as it
 * appears in Stellar SDK / RPC error strings. The code is always a decimal
 * integer.
 */
const CONTRACT_ERROR_RE = /Error\s*\(\s*Contract\s*,\s*#(\d+)\s*\)/;

/**
 * Instantiate the right typed error class for a given contract error code.
 *
 * Codes are derived from the `#[contracterror]` enum in
 * `contracts/sharibo/src/lib.rs` — keep this in sync if the enum changes.
 */
function createContractError(
  code: number,
  message: string,
  cause: unknown,
): ContractError {
  switch (code) {
    case 1:
      return new CircleNotFoundError(message, { cause });
    case 2:
      return new RoundNotFundedError(message, { cause });
    case 3:
      return new WrongRoundTagError(message, { cause });
    case 4:
      return new AlreadyClaimedError(message, { cause });
    case 5:
      return new InvalidProofError(message, { cause });
    case 6:
      return new RoundFullError(message, { cause });
    case 7:
      return new OverflowError(message, { cause });
    case 8:
      return new CircleCancelledError(message, { cause });
    default:
      // Unknown code — still a contract error, just use the base class.
      return new ContractError(message, code, { cause });
  }
}

/**
 * Attempt to extract an `Error(Contract, #N)` from an error value.
 *
 * The Stellar SDK wraps RPC errors in several shapes:
 * - `Error` objects with a `.message` property containing the XDR dump
 * - Plain strings thrown directly
 * - Nested `cause` chains
 *
 * This function walks those layers to find the pattern.
 */
export function decodeContractError(err: unknown): ContractError | RpcError {
  // Collect all candidate strings: the message of the top-level error plus
  // any `.message` from the cause chain. This avoids fragile single-string
  // matching — the code could appear at any depth.
  const candidates: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = err;
  const visited = new Set<unknown>();

  while (current && !visited.has(current)) {
    visited.add(current);

    if (typeof current === "string") {
      candidates.push(current);
    } else if (current instanceof Error) {
      if (current.message) candidates.push(current.message);
      current = current.cause;
      continue;
    } else if (current?.message && typeof current.message === "string") {
      candidates.push(current.message);
    }

    current = current?.cause ?? current?.originalError ?? null;
  }

  // If the caller passed a plain string, test it directly.
  if (typeof err === "string") {
    candidates.push(err);
  }

  // Try each candidate against the pattern (first match wins).
  for (const text of candidates) {
    const match = CONTRACT_ERROR_RE.exec(text);
    if (match) {
      const code = parseInt(match[1], 10);
      return createContractError(
        code,
        `Contract error #${code}: ${text}`,
        err,
      );
    }
  }

  // Not a contract error — wrap in RpcError so callers always get a
  // ShariboError subclass.
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Unknown RPC error";

  return new RpcError(message, { cause: err });
}
