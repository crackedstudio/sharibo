import { test } from "vitest";
import assert from "node:assert/strict";
import { validateCircuitInput, type CircuitInput } from "./prove.js";
import { FR_MODULUS } from "./identity.js";

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
