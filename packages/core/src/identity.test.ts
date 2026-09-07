/**
 * Tests for identity.ts — FR_MODULUS, randomFieldElement, poseidon,
 * generateIdentity, computeNullifierHash, computeExternalNullifier.
 *
 * Runs with vitest (see vitest.config.ts).  Do NOT import from "node:test" —
 * Stryker's vitest runner instruments the module and re-runs these tests; the
 * node:test runner is invisible to it.
 */
import { describe, it, expect } from "vitest";
import {
  FR_MODULUS,
  randomFieldElement,
  poseidon,
  generateIdentity,
  computeNullifierHash,
  computeExternalNullifier,
} from "./identity.js";

describe("FR_MODULUS", () => {
  // Issue #63: pin against independent sources so a transcription error in
  // the hex literal kills the suite rather than silently corrupting every
  // identity and nullifier.
  it("matches the known BLS12-381 scalar field modulus (decimal)", () => {
    expect(FR_MODULUS).toBe(
      52435875175126190479447740508185965837690552500527637822603658699938581184513n,
    );
  });

  it("has bit length 255", () => {
    expect(FR_MODULUS.toString(2).length).toBe(255);
  });

  it("FR_MODULUS - 1 is divisible by 2**32 (FFT-friendly property)", () => {
    expect((FR_MODULUS - 1n) % 2n ** 32n).toBe(0n);
  });
});

// ── randomFieldElement ────────────────────────────────────────────────────────

describe("randomFieldElement", () => {
  // Issue #66: wide reduction (512 bits mod FR_MODULUS).
  it("always returns a value in [0, FR_MODULUS)", () => {
    for (let i = 0; i < 200; i++) {
      const v = randomFieldElement();
      expect(v).toBeGreaterThanOrEqual(0n);
      expect(v).toBeLessThan(FR_MODULUS);
    }
  });

  it("produces distinct values across many draws", () => {
    const draws = Array.from({ length: 50 }, () => randomFieldElement());
    expect(new Set(draws).size).toBeGreaterThan(1);
  });
});

// ── poseidon ──────────────────────────────────────────────────────────────────

describe("poseidon", () => {
  it("is deterministic for the same inputs", () => {
    expect(poseidon(1n, 2n)).toBe(poseidon(1n, 2n));
  });

  it("differs when either argument differs", () => {
    const h = poseidon(1n, 2n);
    expect(poseidon(1n, 3n)).not.toBe(h); // different b
    expect(poseidon(3n, 2n)).not.toBe(h); // different a
  });

  it("is NOT commutative (order matters)", () => {
    // Poseidon2 is not a symmetric function over (a, b).
    // If this ever becomes equal the circuit's sibling-ordering logic breaks.
    expect(poseidon(1n, 2n)).not.toBe(poseidon(2n, 1n));
  });

  it("returns a value in [0, FR_MODULUS)", () => {
    const h = poseidon(42n, 999n);
    expect(h).toBeGreaterThanOrEqual(0n);
    expect(h).toBeLessThan(FR_MODULUS);
  });
});

// ── generateIdentity ──────────────────────────────────────────────────────────

describe("generateIdentity", () => {
  it("commitment equals poseidon(identityNullifier, identitySecret)", () => {
    const id = generateIdentity();
    expect(id.commitment).toBe(poseidon(id.identityNullifier, id.identitySecret));
  });

  it("commitment does NOT equal poseidon(identitySecret, identityNullifier)", () => {
    // Verifies the argument order in the commitment is (nullifier, secret)
    // and not the reverse — a swapped-args mutant would be caught here.
    const id = generateIdentity();
    // The two orderings are equal only if nullifier === secret, which is
    // astronomically unlikely for independent random draws.
    if (id.identityNullifier !== id.identitySecret) {
      expect(id.commitment).not.toBe(poseidon(id.identitySecret, id.identityNullifier));
    }
  });

  it("produces different identities on successive calls", () => {
    const a = generateIdentity();
    const b = generateIdentity();
    expect(a.identityNullifier).not.toBe(b.identityNullifier);
    expect(a.identitySecret).not.toBe(b.identitySecret);
    expect(a.commitment).not.toBe(b.commitment);
  });

  it("all fields are in [0, FR_MODULUS)", () => {
    const id = generateIdentity();
    for (const v of [id.identityNullifier, id.identitySecret, id.commitment]) {
      expect(v).toBeGreaterThanOrEqual(0n);
      expect(v).toBeLessThan(FR_MODULUS);
    }
  });
});

// ── computeNullifierHash ──────────────────────────────────────────────────────

describe("computeNullifierHash", () => {
  it("is deterministic", () => {
    expect(computeNullifierHash(12345n, 67890n)).toBe(computeNullifierHash(12345n, 67890n));
  });

  it("equals poseidon(identityNullifier, externalNullifier)", () => {
    expect(computeNullifierHash(999999n, 888888n)).toBe(poseidon(999999n, 888888n));
  });

  it("does NOT equal poseidon(externalNullifier, identityNullifier)", () => {
    // Argument-order mutation: swapping the two inputs produces a different
    // hash (Poseidon is not commutative).
    const a = 999999n;
    const b = 888888n;
    expect(computeNullifierHash(a, b)).not.toBe(poseidon(b, a));
  });

  it("differs when identityNullifier differs", () => {
    expect(computeNullifierHash(1n, 2n)).not.toBe(computeNullifierHash(3n, 2n));
  });

  it("differs when externalNullifier differs", () => {
    expect(computeNullifierHash(1n, 2n)).not.toBe(computeNullifierHash(1n, 3n));
  });
});

// ── computeExternalNullifier ──────────────────────────────────────────────────

describe("computeExternalNullifier", () => {
  // Issue #65: out-of-range inputs must fail loudly.
  it("accepts round at boundary (2**32 - 1)", async () => {
    await expect(computeExternalNullifier(1n, 2n ** 32n - 1n)).resolves.toBeDefined();
  });

  it("rejects round >= 2**32", async () => {
    await expect(computeExternalNullifier(1n, 2n ** 32n)).rejects.toThrow(RangeError);
  });

  it("rejects negative round", async () => {
    await expect(computeExternalNullifier(1n, -1n)).rejects.toThrow();
  });

  it("accepts circleId at boundary (2**64 - 1)", async () => {
    await expect(computeExternalNullifier(2n ** 64n - 1n, 1n)).resolves.toBeDefined();
  });

  it("rejects circleId >= 2**64", async () => {
    await expect(computeExternalNullifier(2n ** 64n, 1n)).rejects.toThrow(RangeError);
  });

  it("rejects negative circleId", async () => {
    await expect(computeExternalNullifier(-1n, 1n)).rejects.toThrow();
  });

  it("is deterministic for the same (circleId, round)", async () => {
    const a = await computeExternalNullifier(42n, 7n);
    const b = await computeExternalNullifier(42n, 7n);
    expect(a).toBe(b);
  });

  it("result is always in [0, FR_MODULUS)", async () => {
    const pairs: [bigint, bigint][] = [
      [0n, 0n],
      [1n, 0n],
      [0n, 1n],
      [2n ** 32n - 1n, 2n ** 16n],
      [2n ** 64n - 1n, 2n ** 32n - 1n],
    ];
    for (const [id, r] of pairs) {
      const v = await computeExternalNullifier(id, r);
      expect(v).toBeGreaterThanOrEqual(0n);
      expect(v).toBeLessThan(FR_MODULUS);
    }
  });

  it("produces distinct values for distinct (circleId, round) pairs", async () => {
    const pairs: [bigint, bigint][] = [
      [0n, 0n],
      [0n, 1n],
      [1n, 0n],
      [1n, 1n],
      [42n, 7n],
    ];
    const results = new Set(await Promise.all(pairs.map(([id, r]) => computeExternalNullifier(id, r))));
    expect(results.size).toBe(5);
  });

  it("differs when only circleId changes", async () => {
    const a = await computeExternalNullifier(0n, 0n);
    const b = await computeExternalNullifier(1n, 0n);
    expect(a).not.toBe(b);
  });

  it("differs when only round changes", async () => {
    const a = await computeExternalNullifier(0n, 0n);
    const b = await computeExternalNullifier(0n, 1n);
    expect(a).not.toBe(b);
  });

  // Known-answer test: SHA-256([0u8; 12]) reduced mod FR_MODULUS.
  // Value is also the contract's real_external_nullifier_round0 fixture,
  // confirming client/contract wire-format agreement.
  it("known-answer for (0n, 0n)", async () => {
    const expected =
      9916401131788634118796694467337109503795060207059715207260235684299224251787n;
    expect(await computeExternalNullifier(0n, 0n)).toBe(expected);
  });

  it("known-answer for (1n, 0n) differs from (0n, 0n)", async () => {
    // Validates that the circleId byte layout is actually encoded — a
    // mutation that drops the circleId bytes would make these equal.
    const v0 = await computeExternalNullifier(0n, 0n);
    const v1 = await computeExternalNullifier(1n, 0n);
    expect(v0).not.toBe(v1);
  });

  it("known-answer for (0n, 1n) differs from (0n, 0n)", async () => {
    // Same guard for the round bytes.
    const v0 = await computeExternalNullifier(0n, 0n);
    const v1 = await computeExternalNullifier(0n, 1n);
    expect(v0).not.toBe(v1);
  });
});
