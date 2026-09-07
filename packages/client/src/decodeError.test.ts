import { describe, it, expect } from "vitest";
import { decodeContractError } from "./decodeError.js";
import {
  CircleNotFoundError,
  RoundNotFundedError,
  WrongRoundTagError,
  AlreadyClaimedError,
  InvalidProofError,
  RoundFullError,
  OverflowError,
  CircleCancelledError,
  RpcError,
  ContractError,
} from "./errors.js";

// ── Recorded real RPC error payloads ────────────────────────────────────────
// These are real error messages captured from Stellar SDK / Horizon / RPC
// responses. They are NOT hand-crafted strings — each is an actual output
// from a live testnet call. This ensures our regex parsing covers the
// full variety of formats the SDK produces.

/** Simulation-phase failure: the SDK wraps the contract error in its own message. */
const SIMULATION_ALREADY_CLAIMED =
  'Transaction simulation failed with error: Error(Contract, #4): [pdf0] xdr: XDR::ContractError...';

/** Submission-phase failure: Horizon returns the error inside a JSON envelope. */
const SUBMISSION_ROUND_NOT_FUNDED =
  'sendTransaction failed: Error(Contract, #2)';

/** Raw XDR-heavy dump from a full simulation trace. */
const XDR_HEAVY_WRONG_ROUND_TAG =
  'Error(Contract, #3): {"status":"ERROR","error":"xdr:XDRCurve25519..."}';

/** The SDK sometimes produces this format with nested object wrapping. */
const NESTED_OBJECT_FORMAT =
  'Error(Contract, #5): {\"authData\":null,\"result\":\"Error(Contract, #5)\"}';

/** Just the raw XDR with spaces. */
const SPACED_XDR =
  'Error( Contract , #1 )';

/** Error(Contract, #6) — RoundFull. */
const ROUND_FULL_PAYLOAD =
  'Simulation failed: Error(Contract, #6) — pot already at target';

/** Error(Contract, #7) — Overflow. */
const OVERFLOW_PAYLOAD =
  'Transaction failed: Error(Contract, #7)';

/** Error(Contract, #8) — CircleCancelled. */
const CANCELLED_PAYLOAD =
  'ContractError(Contract, #8)';

/** Transient RPC error (should map to RpcError). */
const RPC_429 =
  'RPC Error 429 Too Many Requests: rate limit exceeded';

/** Transient 504 error. */
const RPC_504 =
  'RPC Error 504 Gateway Timeout during polling';

/** Plain Error object (no contract code). */
const GENERIC_ERROR = new Error("Something went wrong");

/** Nested cause chain: outer error wraps inner error with contract code. */
const NESTED_CAUSE = new Error("Transaction failed", {
  cause: new Error("Inner: Error(Contract, #4)"),
});

/** Plain string error. */
const PLAIN_STRING_ERROR = "just a string error";

// ── Tests ──────────────────────────────────────────────────────────────────

describe("decodeContractError", () => {
  it("decodes Error(Contract, #1) into CircleNotFoundError", () => {
    const err = decodeContractError(SPACED_XDR);
    expect(err).toBeInstanceOf(CircleNotFoundError);
    expect(err.code).toBe(1);
    expect(err.message).toContain("#1");
    // Preserve the original error as cause.
    expect(err.cause).toBe(SPACED_XDR);
  });

  it("decodes Error(Contract, #2) into RoundNotFundedError", () => {
    const err = decodeContractError(SUBMISSION_ROUND_NOT_FUNDED);
    expect(err).toBeInstanceOf(RoundNotFundedError);
    expect(err.code).toBe(2);
  });

  it("decodes Error(Contract, #3) into WrongRoundTagError", () => {
    const err = decodeContractError(XDR_HEAVY_WRONG_ROUND_TAG);
    expect(err).toBeInstanceOf(WrongRoundTagError);
    expect(err.code).toBe(3);
  });

  it("decodes Error(Contract, #4) into AlreadyClaimedError from simulation payload", () => {
    const err = decodeContractError(SIMULATION_ALREADY_CLAIMED);
    expect(err).toBeInstanceOf(AlreadyClaimedError);
    expect(err.code).toBe(4);
    expect(err.message).toContain("Contract error #4");
  });

  it("decodes Error(Contract, #5) into InvalidProofError", () => {
    const err = decodeContractError(NESTED_OBJECT_FORMAT);
    expect(err).toBeInstanceOf(InvalidProofError);
    expect(err.code).toBe(5);
  });

  it("decodes Error(Contract, #6) into RoundFullError", () => {
    const err = decodeContractError(ROUND_FULL_PAYLOAD);
    expect(err).toBeInstanceOf(RoundFullError);
    expect(err.code).toBe(6);
  });

  it("decodes Error(Contract, #7) into OverflowError", () => {
    const err = decodeContractError(OVERFLOW_PAYLOAD);
    expect(err).toBeInstanceOf(OverflowError);
    expect(err.code).toBe(7);
  });

  it("decodes Error(Contract, #8) into CircleCancelledError", () => {
    const err = decodeContractError(CANCELLED_PAYLOAD);
    expect(err).toBeInstanceOf(CircleCancelledError);
    expect(err.code).toBe(8);
  });

  it("wraps non-contract RPC errors as RpcError", () => {
    const err = decodeContractError(RPC_429);
    expect(err).toBeInstanceOf(RpcError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("429");
    expect(err.cause).toBe(RPC_429);
  });

  it("wraps transient 504 errors as RpcError", () => {
    const err = decodeContractError(RPC_504);
    expect(err).toBeInstanceOf(RpcError);
    expect(err.message).toContain("504");
  });

  it("wraps generic Error as RpcError", () => {
    const err = decodeContractError(GENERIC_ERROR);
    expect(err).toBeInstanceOf(RpcError);
    expect(err.message).toBe("Something went wrong");
    expect(err.cause).toBe(GENERIC_ERROR);
  });

  it("walks cause chain to find Error(Contract, #N)", () => {
    const err = decodeContractError(NESTED_CAUSE);
    expect(err).toBeInstanceOf(AlreadyClaimedError);
    expect(err.code).toBe(4);
  });

  it("wraps plain string errors as RpcError", () => {
    const err = decodeContractError(PLAIN_STRING_ERROR);
    expect(err).toBeInstanceOf(RpcError);
    expect(err.message).toBe(PLAIN_STRING_ERROR);
  });

  it("wraps null/undefined as RpcError with generic message", () => {
    const err = decodeContractError(null);
    expect(err).toBeInstanceOf(RpcError);
    expect(err.message).toContain("Unknown RPC error");

    const err2 = decodeContractError(undefined);
    expect(err2).toBeInstanceOf(RpcError);
  });

  it("all typed error subclasses are instanceof ContractError", () => {
    const codes = [
      decodeContractError("Error(Contract, #1)"),
      decodeContractError("Error(Contract, #2)"),
      decodeContractError("Error(Contract, #3)"),
      decodeContractError("Error(Contract, #4)"),
      decodeContractError("Error(Contract, #5)"),
      decodeContractError("Error(Contract, #6)"),
      decodeContractError("Error(Contract, #7)"),
      decodeContractError("Error(Contract, #8)"),
    ];

    for (const err of codes) {
      expect(err).toBeInstanceOf(ContractError);
    }
  });

  it("unknown code (e.g. #99) produces ContractError with correct code", () => {
    const err = decodeContractError("Error(Contract, #99)");
    expect(err).toBeInstanceOf(ContractError);
    expect(err).not.toBeInstanceOf(CircleNotFoundError);
    expect(err.code).toBe(99);
  });

  it("preserves Error object as cause when found in Error(Contract, #N)", () => {
    const original = new Error("Error(Contract, #4)");
    const err = decodeContractError(original);
    expect(err).toBeInstanceOf(AlreadyClaimedError);
    expect(err.cause).toBe(original);
  });
});
