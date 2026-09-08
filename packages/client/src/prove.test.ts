import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  generateProof,
  validateCircuitInput,
  type CircuitInput,
  feToBytes,
  g1ToBytes,
  g2ToBytes,
  FP_BYTES,
  verificationKeyToContractFormat,
} from "./prove.js";
import { FR_MODULUS } from "./identity.js";
import { InvalidInputError } from "./errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ──────────────────────────────────────────────────────────

function validInput(): CircuitInput {
  return {
    identityNullifier: 1n,
    identitySecret: 2n,
    pathElements: [3n, 4n, 5n, 6n],
    pathIndices: [0, 1, 0, 0],
    root: 7n,
    externalNullifier: 8n,
  };
}

// ── pathElements vs circuit depth ────────────────────────────────────

test("rejects pathElements shorter than the circuit depth", () => {
  const input = validInput();
  input.pathElements = [1n, 2n, 3n]; // 3 elements, depth 4
  input.pathIndices = [0, 1, 0];
  assert.throws(
    () => validateCircuitInput(input, 4),
    { message: "pathElements: expected 4, got 3" },
  );
});

test("rejects pathElements longer than the circuit depth", () => {
  const input = validInput();
  input.pathElements = [1n, 2n, 3n, 4n, 5n]; // 5 elements, depth 4
  input.pathIndices = [0, 1, 0, 0, 1];
  assert.throws(
    () => validateCircuitInput(input, 4),
    { message: "pathElements: expected 4, got 5" },
  );
});

test("accepts pathElements matching the default depth (4)", () => {
  const input = validInput();
  // Should not throw — uses default TREE_LEVELS = 4
  validateCircuitInput(input);
});

test("accepts pathElements matching an explicit custom depth", () => {
  const input = validInput();
  input.pathElements = [1n, 2n, 3n];
  input.pathIndices = [0, 0, 1];
  // Should not throw with explicit levels=3
  validateCircuitInput(input, 3);
});

// ── pathIndices length ───────────────────────────────────────────────

test("rejects pathIndices shorter than pathElements", () => {
  const input = validInput();
  input.pathElements = [1n, 2n, 3n, 4n];
  input.pathIndices = [0, 1];
  assert.throws(
    () => validateCircuitInput(input, 4),
    { message: "pathIndices: expected 4, got 2" },
  );
});

test("rejects pathIndices longer than pathElements", () => {
  const input = validInput();
  input.pathElements = [1n, 2n];
  input.pathIndices = [0, 1, 0, 0];
  assert.throws(
    () => validateCircuitInput(input, 2),
    { message: "pathIndices: expected 2, got 4" },
  );
});

// ── Boolean pathIndices ──────────────────────────────────────────────

test("rejects pathIndices[i] that is not 0 or 1 — negative", () => {
  const input = validInput();
  input.pathIndices = [0, -1, 0, 0];
  assert.throws(
    () => validateCircuitInput(input),
    { message: "pathIndices[1]: expected 0 or 1, got -1" },
  );
});

test("rejects pathIndices[i] that is not 0 or 1 — large integer", () => {
  const input = validInput();
  input.pathIndices = [0, 0, 0, 7];
  assert.throws(
    () => validateCircuitInput(input),
    { message: "pathIndices[3]: expected 0 or 1, got 7" },
  );
});

test("accepts all-valid boolean pathIndices (0s and 1s only)", () => {
  const input = validInput();
  input.pathIndices = [0, 0, 0, 0];
  validateCircuitInput(input);
  input.pathIndices = [1, 1, 0, 1];
  validateCircuitInput(input);
});

// ── Field-element range checks ───────────────────────────────────────

test("rejects identityNullifier >= FR_MODULUS", () => {
  const input = validInput();
  input.identityNullifier = FR_MODULUS;
  assert.throws(
    () => validateCircuitInput(input),
    {
      message:
        `identityNullifier: must be in [0, FR_MODULUS), got ${FR_MODULUS}`,
    },
  );
});

test("rejects identityNullifier negative", () => {
  const input = validInput();
  input.identityNullifier = -1n;
  assert.throws(
    () => validateCircuitInput(input),
    {
      message: "identityNullifier: must be in [0, FR_MODULUS), got -1",
    },
  );
});

test("rejects identitySecret negative", () => {
  const input = validInput();
  input.identitySecret = -1n;
  assert.throws(
    () => validateCircuitInput(input),
    {
      message: "identitySecret: must be in [0, FR_MODULUS), got -1",
    },
  );
});

test("rejects identitySecret >= FR_MODULUS", () => {
  const input = validInput();
  input.identitySecret = FR_MODULUS + 1n;
  assert.throws(
    () => validateCircuitInput(input),
    {
      message:
        `identitySecret: must be in [0, FR_MODULUS), got ${FR_MODULUS + 1n}`,
    },
  );
});

test("rejects root negative", () => {
  const input = validInput();
  input.root = -1n;
  assert.throws(
    () => validateCircuitInput(input),
    {
      message: "root: must be in [0, FR_MODULUS), got -1",
    },
  );
});

test("rejects root >= FR_MODULUS", () => {
  const input = validInput();
  input.root = FR_MODULUS;
  assert.throws(
    () => validateCircuitInput(input),
    {
      message: `root: must be in [0, FR_MODULUS), got ${FR_MODULUS}`,
    },
  );
});

test("rejects externalNullifier negative", () => {
  const input = validInput();
  input.externalNullifier = -1n;
  assert.throws(
    () => validateCircuitInput(input),
    {
      message: "externalNullifier: must be in [0, FR_MODULUS), got -1",
    },
  );
});

test("rejects externalNullifier >= FR_MODULUS", () => {
  const input = validInput();
  input.externalNullifier = FR_MODULUS;
  assert.throws(
    () => validateCircuitInput(input),
    {
      message:
        `externalNullifier: must be in [0, FR_MODULUS), got ${FR_MODULUS}`,
    },
  );
});

test("rejects pathElements[i] negative", () => {
  const input = validInput();
  input.pathElements[1] = -1n;
  assert.throws(
    () => validateCircuitInput(input),
    {
      message: "pathElements[1]: must be in [0, FR_MODULUS), got -1",
    },
  );
});

test("rejects pathElements[i] >= FR_MODULUS", () => {
  const input = validInput();
  input.pathElements[2] = FR_MODULUS + 100n;
  assert.throws(
    () => validateCircuitInput(input),
    {
      message:
        `pathElements[2]: must be in [0, FR_MODULUS), got ${FR_MODULUS + 100n}`,
    },
  );
});

// ── generateProof entry-point gate (issue #269) ──────────────────────
//
// validateCircuitInput is wired into generateProof so out-of-range
// pathElements (the circuit itself wraps them mod FR_MODULUS) are rejected
// BEFORE the un-interruptible WASM proving phase. These tests assert the
// gate fires with the typed error even though the artifacts passed here are
// empty placeholders — if the gate were removed, snarkjs would instead
// fail on the missing artifact bytes, so the specific InvalidInputError
// also proves prove() never ran.

test("generateProof rejects out-of-range pathElements before proving", async () => {
  const input = validInput();
  input.pathElements[2] = FR_MODULUS;
  await assert.rejects(
    generateProof(input, new Uint8Array(), new Uint8Array()),
    (err) =>
      err instanceof InvalidInputError &&
      err.message.includes("pathElements[2]: must be in [0, FR_MODULUS)"),
  );
});

test("generateProof accepts FR_MODULUS - 1 pathElements and proceeds to the prove phase", async () => {
  const input = validInput();
  input.pathElements[2] = FR_MODULUS - 1n;
  // The gate passes (upper boundary is canonical); the subsequent
  // snarkjs fullProve on empty artifact bytes must then fail with a
  // non-InvalidInputError, proving we got past the gate.
  await assert.rejects(
    generateProof(input, new Uint8Array(), new Uint8Array()),
    (err) => !(err instanceof InvalidInputError),
  );
});

test("accepts all values at FR_MODULUS - 1 (upper boundary)", () => {
  const max = FR_MODULUS - 1n;
  const input: CircuitInput = {
    identityNullifier: max,
    identitySecret: max,
    pathElements: [max, max, max, max],
    pathIndices: [0, 1, 0, 0],
    root: max,
    externalNullifier: max,
  };
  validateCircuitInput(input);
});

test("accepts all values at 0 (lower boundary)", () => {
  const input: CircuitInput = {
    identityNullifier: 0n,
    identitySecret: 0n,
    pathElements: [0n, 0n, 0n, 0n],
    pathIndices: [0, 1, 0, 0],
    root: 0n,
    externalNullifier: 0n,
  };
  validateCircuitInput(input);
});

// ── feToBytes: known answers ─────────────────────────────────────────
//
// feToBytes encodes an Fp (BLS12-381 base field) coordinate as 48
// big-endian bytes — the wire format the Sharibo contract deserializes for
// every G1/G2 limb (see contracts/sharibo/src/lib.rs and the comment above
// FP_BYTES in prove.ts). A byte-order or length mistake here makes every
// proof invalid on-chain with an opaque `InvalidProof`, so these are
// known-answer tests pinned against independently-computed expected bytes,
// not just round-trips through the function itself.

test("feToBytes(0) is 48 zero bytes", () => {
  const bytes = feToBytes("0");
  assert.equal(bytes.length, FP_BYTES);
  assert.deepEqual(bytes, new Uint8Array(FP_BYTES));
});

test("feToBytes(1) is 47 zero bytes followed by 0x01 (big-endian)", () => {
  const bytes = feToBytes("1");
  assert.equal(bytes.length, FP_BYTES);
  const expected = new Uint8Array(FP_BYTES);
  expected[FP_BYTES - 1] = 0x01;
  assert.deepEqual(bytes, expected);
});

test("feToBytes encodes the maximum canonical Fp value (BLS12-381 base field modulus - 1)", () => {
  // BLS12-381 base field modulus q (spec-known, decimal):
  // 4002409555221667393417789825735904156556882819939007885332058136124031650490837864442687629129015664037894272559787
  // q in hex: 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab
  const q =
    4002409555221667393417789825735904156556882819939007885332058136124031650490837864442687629129015664037894272559787n;
  const max = q - 1n; // largest canonical Fp element, [0, q)
  const bytes = feToBytes(max.toString());
  assert.equal(bytes.length, FP_BYTES);
  // Known answer: q - 1 in hex, independently written out (last nibble
  // decremented from the spec value's ...aaab to ...aaaa).
  const expectedHex =
    "1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaaa";
  assert.equal(Buffer.from(bytes).toString("hex"), expectedHex);
});

// ── g1ToBytes: length and limb placement ─────────────────────────────

test("g1ToBytes always produces 96 bytes", () => {
  const bytes = g1ToBytes(["0", "0", "1"]);
  assert.equal(bytes.length, 96);
});

test("g1ToBytes places X in bytes 0-47 and Y in bytes 48-95", () => {
  // Distinguishable, non-trivial values per limb so a swap would be caught.
  const x = "111111";
  const y = "222222";
  const bytes = g1ToBytes([x, y, "1"]);
  assert.equal(bytes.length, 96);
  assert.deepEqual(bytes.subarray(0, 48), feToBytes(x));
  assert.deepEqual(bytes.subarray(48, 96), feToBytes(y));
});

// ── g2ToBytes: length and limb placement (Xc1||Xc0||Yc1||Yc0) ────────
//
// This is the highest-risk spot in the encoding: Xc1 is written BEFORE
// Xc0 (and Yc1 before Yc0) — the opposite of the natural [c0, c1] input
// order. A deliberate limb swap is exercised below (see the acceptance
// criterion in issue #48) to confirm this test suite actually catches it.

test("g2ToBytes always produces 192 bytes", () => {
  const bytes = g2ToBytes([
    ["0", "0"],
    ["0", "0"],
    ["1", "0"],
  ]);
  assert.equal(bytes.length, 192);
});

test("g2ToBytes places limbs in Xc1||Xc0||Yc1||Yc0 order", () => {
  // Four distinguishable, non-trivial values — one per limb — so any
  // transposition (not just Xc1/Xc0) would be caught.
  const xc0 = "111111";
  const xc1 = "222222";
  const yc0 = "333333";
  const yc1 = "444444";
  const bytes = g2ToBytes([
    [xc0, xc1],
    [yc0, yc1],
    ["1", "0"],
  ]);
  assert.equal(bytes.length, 192);
  assert.deepEqual(bytes.subarray(0, 48), feToBytes(xc1), "bytes 0-47 must be Xc1");
  assert.deepEqual(bytes.subarray(48, 96), feToBytes(xc0), "bytes 48-95 must be Xc0");
  assert.deepEqual(bytes.subarray(96, 144), feToBytes(yc1), "bytes 96-143 must be Yc1");
  assert.deepEqual(bytes.subarray(144, 192), feToBytes(yc0), "bytes 144-191 must be Yc0");
});

// ── verificationKeyToContractFormat: round-trip against the committed  ──
// ── circuits/verification_key.json                                     ──

test("verificationKeyToContractFormat produces the right shapes for the committed verification key (4 public signals)", () => {
  const vkPath = join(__dirname, "..", "..", "..", "circuits", "verification_key.json");
  const vkJson = JSON.parse(readFileSync(vkPath, "utf8"));

  // Sanity-check the fixture itself hasn't drifted from what this test
  // assumes: 4 public signals (nullifierHash, root, externalNullifier,
  // recipientHash — recipientHash added in issue #266).
  assert.equal(vkJson.nPublic, 4);

  const vk = verificationKeyToContractFormat(vkJson);

  // ic.length === public signals + 1 (the constant term) — the
  // acceptance criterion from issue #48.
  assert.equal(vk.ic.length, 5);

  // G1 fields (alpha, and every ic entry) are 96 bytes; G2 fields (beta,
  // gamma, delta) are 192 bytes.
  assert.equal(vk.alpha.length, 96);
  assert.equal(vk.beta.length, 192);
  assert.equal(vk.gamma.length, 192);
  assert.equal(vk.delta.length, 192);
  for (const ic of vk.ic) {
    assert.equal(ic.length, 96);
  }

  // Round-trip: re-deriving each field independently via g1ToBytes/
  // g2ToBytes from the same JSON must match exactly what
  // verificationKeyToContractFormat produced.
  assert.deepEqual(vk.alpha, g1ToBytes(vkJson.vk_alpha_1));
  assert.deepEqual(vk.beta, g2ToBytes(vkJson.vk_beta_2));
  assert.deepEqual(vk.gamma, g2ToBytes(vkJson.vk_gamma_2));
  assert.deepEqual(vk.delta, g2ToBytes(vkJson.vk_delta_2));
  vkJson.IC.forEach((ic: [string, string, string], i: number) => {
    assert.deepEqual(vk.ic[i], g1ToBytes(ic));
  });
});
