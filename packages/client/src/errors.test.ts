import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ContractError,
  describeContractError,
  parseContractErrorCode,
  describeError,
} from "./errors.js";

// Issue #53: contracts/sharibo/src/lib.rs's `Error` enum, discriminants 1-5.
test("describeContractError returns the right name for each of the 5 known codes", () => {
  assert.equal(describeContractError(1)?.name, "CircleNotFound");
  assert.equal(describeContractError(2)?.name, "RoundNotFunded");
  assert.equal(describeContractError(3)?.name, "WrongRoundTag");
  assert.equal(describeContractError(4)?.name, "AlreadyClaimed");
  assert.equal(describeContractError(5)?.name, "InvalidProof");
});

test("describeContractError includes a user-facing sentence and a hint for every known code", () => {
  for (const code of [1, 2, 3, 4, 5]) {
    const description = describeContractError(code);
    assert.ok(description, `expected a description for code ${code}`);
    assert.equal(description!.code, code);
    assert.ok(description!.message.length > 0);
    assert.ok(description!.hint.length > 0);
  }
});

test("describeContractError(4) matches AlreadyClaimed's documented semantics (nullifier reuse)", () => {
  const description = describeContractError(4);
  assert.match(description!.message, /nullifier/i);
  assert.match(description!.message, /already/i);
});

test("describeContractError returns undefined for unknown codes", () => {
  assert.equal(describeContractError(0), undefined);
  assert.equal(describeContractError(6), undefined); // RoundFull — real code, out of Issue #53's scope
  assert.equal(describeContractError(7), undefined); // Overflow
  assert.equal(describeContractError(8), undefined); // CircleCancelled
  assert.equal(describeContractError(999), undefined);
});

// The exact shape signAndSend()'s underlying @stellar/stellar-sdk throws:
// traced through node_modules/@stellar/stellar-sdk's AssembledTransaction
// (simulationData getter -> SimulationFailed with the RPC's raw diagnostic
// string embedded) and cross-checked against contract/utils.js's own
// `contractErrorPattern = /Error\(Contract, #(\d+)\)/`, plus the existing
// raw-string checks in scripts/e2e.ts and scripts/smoke.ts.
test("parseContractErrorCode extracts the code from a signAndSend-shaped Error", () => {
  const error = new Error(
    'Transaction simulation failed: "HostError: Error(Contract, #4)\n\nEvent log (newest first):\n   0: [Diagnostic Event] contract:abc, topics:[error, Error(Contract, #4)], data:[\"claim\", \"AlreadyClaimed\"]"',
  );
  assert.equal(parseContractErrorCode(error), 4);
});

test("parseContractErrorCode matches the exact minimal shape used in scripts/e2e.ts and scripts/smoke.ts", () => {
  assert.equal(parseContractErrorCode(new Error("Error(Contract, #4)")), 4);
  assert.equal(parseContractErrorCode(new Error("Error(Contract, #1)")), 1);
});

test("parseContractErrorCode reads the code straight off a ContractError instance", () => {
  const error = new ContractError("claim rejected", 5);
  assert.equal(parseContractErrorCode(error), 5);
});

test("parseContractErrorCode returns undefined for errors that aren't contract rejections", () => {
  assert.equal(parseContractErrorCode(new Error("RPC Error 429 Too Many Requests")), undefined);
  assert.equal(parseContractErrorCode(new Error("network timeout")), undefined);
  assert.equal(parseContractErrorCode("not an error at all"), undefined);
  assert.equal(parseContractErrorCode(null), undefined);
  assert.equal(parseContractErrorCode(undefined), undefined);
});

// Acceptance criterion: the replay demo shows "AlreadyClaimed: ..." prose
// instead of the raw `Error(Contract, #4)`.
test("describeError renders a known contract rejection as 'Name: sentence hint' prose", () => {
  const error = new Error("Error(Contract, #4)");
  const text = describeError(error);
  assert.match(text, /^AlreadyClaimed:/);
  assert.match(text, /nullifier/i);
  assert.doesNotMatch(text, /Error\(Contract/);
});

test("describeError falls back to the raw message for an unrecognized contract error code", () => {
  const error = new Error("Error(Contract, #6)"); // RoundFull — real, but out of scope
  assert.equal(describeError(error), "Error(Contract, #6)");
});

test("describeError falls back to the raw message for a non-contract error", () => {
  const error = new Error("RPC Error 503 Service Unavailable");
  assert.equal(describeError(error), "RPC Error 503 Service Unavailable");
});

test("describeError never throws on a non-Error, non-string throw", () => {
  assert.equal(describeError({ weird: "shape" }), "Something went wrong. Please retry.");
  assert.equal(describeError(null), "Something went wrong. Please retry.");
  assert.equal(describeError(undefined), "Something went wrong. Please retry.");
});
