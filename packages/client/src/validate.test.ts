import { test } from "vitest";
import assert from "node:assert/strict";
import {
  verificationKeyToContractFormat,
  type ContractProof,
  type ContractVerificationKey,
} from "./prove.js";
import { validateContractProof, validateContractVerificationKey } from "./validate.js";
import { InvalidInputError } from "./errors.js";

function makeG1(x: bigint, y: bigint): Uint8Array {
  const bytes = new Uint8Array(96);
  const xBytes = new Uint8Array(32);
  const yBytes = new Uint8Array(32);
  let v = x;
  for (let i = 31; i >= 0; i--) {
    xBytes[i] = Number(v & 0xffn);
    v = v >> 8n;
  }
  v = y;
  for (let i = 31; i >= 0; i--) {
    yBytes[i] = Number(v & 0xffn);
    v = v >> 8n;
  }
  bytes.set(xBytes, 0);
  bytes.set(yBytes, 48);
  return bytes;
}

function makeG2(
  x1: bigint, x0: bigint, y1: bigint, y0: bigint,
): Uint8Array {
  const bytes = new Uint8Array(192);
  const buf = new Uint8Array(32);
  let v: bigint;
  let offset = 0;
  for (const coord of [x1, x0, y1, y0]) {
    v = coord;
    for (let i = 31; i >= 0; i--) {
      buf[i] = Number(v & 0xffn);
      v = v >> 8n;
    }
    bytes.set(buf, offset);
    offset += 32;
  }
  return bytes;
}

function makeProof(a: Uint8Array, b: Uint8Array, c: Uint8Array): ContractProof {
  return { a, b, c };
}

function makeVK(ic: Uint8Array[]): ContractVerificationKey {
  const alpha = makeG1(1n, 2n);
  const beta = makeG2(3n, 4n, 5n, 6n);
  const gamma = makeG2(7n, 8n, 9n, 10n);
  const delta = makeG2(11n, 12n, 13n, 14n);
  return { alpha, beta, gamma, delta, ic };
}

const ZERO_96 = new Uint8Array(96);
const ZERO_192 = new Uint8Array(192);

// ── ContractProof validation ──────────────────────────────────────────

test("accepts a well-formed proof", () => {
  validateContractProof(makeProof(ZERO_96, ZERO_192, ZERO_96));
});

test("rejects proof.a that is not a Uint8Array", () => {
  assert.throws(
    () => validateContractProof({ a: "bad", b: ZERO_192, c: ZERO_96 } as unknown as ContractProof),
    InvalidInputError,
  );
});

test("rejects proof.a with wrong length", () => {
  assert.throws(
    () => validateContractProof(makeProof(new Uint8Array(10), ZERO_192, ZERO_96)),
    (err: Error) => err.message.includes("proof.a: expected 96 bytes"),
  );
});

test("rejects proof.b with wrong length", () => {
  assert.throws(
    () => validateContractProof(makeProof(ZERO_96, new Uint8Array(10), ZERO_96)),
    (err: Error) => err.message.includes("proof.b: expected 192 bytes"),
  );
});

test("rejects proof.c with wrong length", () => {
  assert.throws(
    () => validateContractProof(makeProof(ZERO_96, ZERO_192, new Uint8Array(10))),
    (err: Error) => err.message.includes("proof.c: expected 96 bytes"),
  );
});

// ── ContractVerificationKey validation ────────────────────────────────

test("accepts a well-formed verification key", () => {
  validateContractVerificationKey(makeVK([ZERO_96, ZERO_96]));
});

test("rejects vk.alpha that is not a Uint8Array", () => {
  const vk = makeVK([ZERO_96]);
  (vk as unknown as Record<string, unknown>).alpha = "bad";
  assert.throws(() => validateContractVerificationKey(vk), InvalidInputError);
});

test("rejects vk.alpha with wrong length", () => {
  const vk = makeVK([ZERO_96]);
  vk.alpha = new Uint8Array(10);
  assert.throws(
    () => validateContractVerificationKey(vk),
    (err: Error) => err.message.includes("vk.alpha: expected 96 bytes"),
  );
});

test("rejects vk.beta with wrong length", () => {
  const vk = makeVK([ZERO_96]);
  vk.beta = new Uint8Array(10);
  assert.throws(
    () => validateContractVerificationKey(vk),
    (err: Error) => err.message.includes("vk.beta: expected 192 bytes"),
  );
});

test("rejects vk.gamma with wrong length", () => {
  const vk = makeVK([ZERO_96]);
  vk.gamma = new Uint8Array(10);
  assert.throws(
    () => validateContractVerificationKey(vk),
    (err: Error) => err.message.includes("vk.gamma: expected 192 bytes"),
  );
});

test("rejects vk.delta with wrong length", () => {
  const vk = makeVK([ZERO_96]);
  vk.delta = new Uint8Array(10);
  assert.throws(
    () => validateContractVerificationKey(vk),
    (err: Error) => err.message.includes("vk.delta: expected 192 bytes"),
  );
});

test("rejects vk.ic that is not an array", () => {
  const vk = makeVK([ZERO_96] as unknown as Uint8Array[]);
  vk.ic = "bad" as unknown as Uint8Array[];
  assert.throws(() => validateContractVerificationKey(vk), InvalidInputError);
});

test("rejects vk.ic with fewer than 1 entry", () => {
  assert.throws(
    () => validateContractVerificationKey(makeVK([])),
    (err: Error) => err.message.includes("vk.ic: must have at least 1 entry"),
  );
});

test("rejects vk.ic entry with wrong length", () => {
  assert.throws(
    () => validateContractVerificationKey(makeVK([new Uint8Array(10)])),
    (err: Error) => err.message.includes("vk.ic[0]: expected 96 bytes"),
  );
});

// ── verificationKeyToContractFormat ──────────────────────────────────

test("converts a minimal valid VK JSON", () => {
  const vkJson = {
    nPublic: 1,
    vk_alpha_1: ["0", "0", "1"],
    vk_beta_2: [["0", "0"], ["0", "0"], ["1", "0"]],
    vk_gamma_2: [["0", "0"], ["0", "0"], ["1", "0"]],
    vk_delta_2: [["0", "0"], ["0", "0"], ["1", "0"]],
    IC: [
      ["0", "0", "1"],
      ["0", "0", "1"],
    ],
  };
  const vk = verificationKeyToContractFormat(vkJson);
  assert.equal(vk.ic.length, 2);
  assert.equal(vk.alpha.length, 96);
  assert.equal(vk.beta.length, 192);
});

test("rejects VK JSON with IC length not equal to nPublic + 1", () => {
  const vkJson = {
    nPublic: 2,
    vk_alpha_1: ["0", "0", "1"],
    vk_beta_2: [["0", "0"], ["0", "0"], ["1", "0"]],
    vk_gamma_2: [["0", "0"], ["0", "0"], ["1", "0"]],
    vk_delta_2: [["0", "0"], ["0", "0"], ["1", "0"]],
    IC: [
      ["0", "0", "1"],
    ],
  };
  assert.throws(
    () => verificationKeyToContractFormat(vkJson),
    (err: Error) => err.message.includes("IC length 1 does not match nPublic + 1 (3)"),
  );
});

test("rejects VK JSON missing nPublic", () => {
  const vkJson = {
    vk_alpha_1: ["0", "0", "1"],
    vk_beta_2: [["0", "0"], ["0", "0"], ["1", "0"]],
    vk_gamma_2: [["0", "0"], ["0", "0"], ["1", "0"]],
    vk_delta_2: [["0", "0"], ["0", "0"], ["1", "0"]],
    IC: [["0", "0", "1"]],
  };
  assert.throws(
    () => verificationKeyToContractFormat(vkJson),
    (err: Error) => err.message.includes("missing nPublic"),
  );
});
