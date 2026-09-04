import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FR_MODULUS,
  randomFieldElement,
  computeExternalNullifier,
  generateIdentity,
  poseidon,
  computeNullifierHash,
} from "./identity.js";
import { InvalidInputError } from "./errors.js";


// Issue #63: pin FR_MODULUS against independent sources so a transcription
// error in the hex literal fails the suite instead of silently corrupting
// every identity and nullifier.
test("FR_MODULUS matches the known BLS12-381 scalar field modulus", () => {
  // Decimal value from the BLS12-381 spec.
  const expectedDecimal =
    52435875175126190479447740508185965837690552500527637822603658699938581184513n;
  assert.equal(FR_MODULUS, expectedDecimal);
});

test("FR_MODULUS has the expected bit length (255)", () => {
  assert.equal(FR_MODULUS.toString(2).length, 255);
});

test("FR_MODULUS - 1 is divisible by 2**32 (known FFT-friendly property)", () => {
  assert.equal((FR_MODULUS - 1n) % 2n ** 32n, 0n);
});

// Issue #66: randomFieldElement now uses wide reduction (512 random bits mod
// FR_MODULUS) rather than 31-byte narrow sampling, so it draws uniformly
// from the full field. Verify the invariant that must always hold.
test("randomFieldElement always returns a value below FR_MODULUS", () => {
  for (let i = 0; i < 200; i++) {
    const value = randomFieldElement();
    assert.ok(value >= 0n);
    assert.ok(value < FR_MODULUS);
  }
});

test("randomFieldElement produces differing values across many draws", () => {
  // Sanity check that the RNG is actually producing different values
  // rather than always returning the same constant.
  const draws = Array.from({ length: 50 }, () => randomFieldElement());
  const unique = new Set(draws);
  assert.ok(
    unique.size > 1,
    `expected at least 2 unique values across 50 draws, got ${unique.size}`,
  );
});

// generateIdentity tests
test("generateIdentity commitment equals poseidon(identityNullifier, identitySecret)", () => {
  const id = generateIdentity();
  const expected = poseidon(id.identityNullifier, id.identitySecret);
  assert.equal(id.commitment, expected);
});

test("generateIdentity produces different values on successive calls", () => {
  const a = generateIdentity();
  const b = generateIdentity();
  // All three fields should differ across two independent calls.
  assert.notEqual(a.identityNullifier, b.identityNullifier);
  assert.notEqual(a.identitySecret, b.identitySecret);
  assert.notEqual(a.commitment, b.commitment);
});

// computeNullifierHash tests
test("computeNullifierHash is deterministic for the same inputs", () => {
  const nullifier = 12345n;
  const external = 67890n;
  const first = computeNullifierHash(nullifier, external);
  const second = computeNullifierHash(nullifier, external);
  assert.equal(first, second);
});

test("computeNullifierHash matches poseidon(identityNullifier, externalNullifier)", () => {
  const nullifier = 999999n;
  const external = 888888n;
  const expected = poseidon(nullifier, external);
  assert.equal(computeNullifierHash(nullifier, external), expected);
});

test("computeNullifierHash produces different values for different inputs", () => {
  const hashA = computeNullifierHash(1n, 2n);
  const hashB = computeNullifierHash(1n, 3n); // different externalNullifier
  const hashC = computeNullifierHash(2n, 2n); // different identityNullifier
  assert.notEqual(hashA, hashB);
  assert.notEqual(hashA, hashC);
  assert.notEqual(hashB, hashC);
});

// Issue #65: out-of-range circleId/round must fail loudly rather than
// producing a silently truncated (and therefore wrong) hash.
test("computeExternalNullifier accepts the round boundary (2**32 - 1)", async () => {
  await computeExternalNullifier(1n, 2n ** 32n - 1n);
});

test("computeExternalNullifier rejects round >= 2**32", async () => {
  await assert.rejects(() => computeExternalNullifier(1n, 2n ** 32n), RangeError);
});

test("computeExternalNullifier rejects negative round", async () => {
  await assert.rejects(() => computeExternalNullifier(1n, -1n), RangeError);
});

test("computeExternalNullifier accepts the circleId boundary (2**64 - 1)", async () => {
  await computeExternalNullifier(2n ** 64n - 1n, 1n);
});

test("computeExternalNullifier rejects circleId >= 2**64", async () => {
  await assert.rejects(() => computeExternalNullifier(2n ** 64n, 1n), RangeError);
});

test("computeExternalNullifier rejects negative circleId", async () => {
  await assert.rejects(() => computeExternalNullifier(-1n, 1n), RangeError);
});

test("computeExternalNullifier is deterministic for the same (circleId, round)", async () => {
  const first = await computeExternalNullifier(42n, 7n);
  const second = await computeExternalNullifier(42n, 7n);
  assert.equal(first, second);
});

test("computeExternalNullifier result is always below FR_MODULUS", async () => {
  for (const [id, r] of [
    [0n, 0n],
    [1n, 0n],
    [0n, 1n],
    [2n ** 32n - 1n, 2n ** 16n],
    [2n ** 64n - 1n, 2n ** 32n - 1n],
  ]) {
    const result = await computeExternalNullifier(id, r);
    assert.ok(
      result >= 0n && result < FR_MODULUS,
      `computeExternalNullifier(${id}, ${r}) = ${result} is not in [0, FR_MODULUS)`,
    );
  }
});

test("computeExternalNullifier yields different values for different (circleId, round) pairs", async () => {
  const results = new Set<bigint>();
  for (const [id, r] of [
    [0n, 0n],
    [0n, 1n],
    [1n, 0n],
    [1n, 1n],
    [42n, 7n],
  ]) {
    results.add(await computeExternalNullifier(id, r));
  }
  assert.equal(
    results.size,
    5,
    "expected all 5 (circleId, round) pairs to produce distinct external nullifiers",
  );
});

// Known-answer test for computeExternalNullifier(0n, 0n):
// SHA-256 of [0u8; 12] (circleId = 0 as u64 big-endian || round = 0 as u32
// big-endian) produces digest 15ec7bf0b50732b49f8228e07d24365338f9e3ab994b00af08e5a3bffe55fd8b,
// which reduced mod FR_MODULUS (the digest is already < FR_MODULUS) equals
// 9916401131788634118796694467337109503795060207059715207260235684299224251787.
// This value is also the contract's real_external_nullifier_round0 fixture
// (contracts/sharibo/src/test.rs), confirming client/contract agreement.
test("computeExternalNullifier known-answer test for (0n, 0n)", async () => {
  const expected =
    9916401131788634118796694467337109503795060207059715207260235684299224251787n;
  const result = await computeExternalNullifier(0n, 0n);
  assert.equal(result, expected);
});
