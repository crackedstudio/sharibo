import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { poseidon, computeExternalNullifier } from "./identity.js";

// Cross-implementation fixture shared with circuits/test/membership.test.js
// (see test-vectors/generate.mjs). If only ONE side fails after a
// dependency bump, the client and circuit Poseidon implementations have
// diverged - do NOT edit the vectors to match, fix the divergence instead.
const __dirname = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "..", "test-vectors", "poseidon.json"), "utf8"),
);

test("poseidon2 pair vectors match the committed fixture", () => {
  for (const { a, b, poseidon2: expected } of vectors.poseidon2PairVectors) {
    assert.equal(poseidon(BigInt(a), BigInt(b)).toString(), expected);
  }
});

test("commitment example matches the committed fixture", () => {
  const { identityNullifier, identitySecret, commitment } = vectors.commitmentExample;
  assert.equal(poseidon(BigInt(identityNullifier), BigInt(identitySecret)).toString(), commitment);
});

test("nullifierHash example matches the committed fixture", () => {
  const { identityNullifier, externalNullifier, nullifierHash } = vectors.nullifierHashExample;
  assert.equal(
    poseidon(BigInt(identityNullifier), BigInt(externalNullifier)).toString(),
    nullifierHash,
  );
});

test("full circuit example: externalNullifier, merkle path, and nullifierHash all reproduce", async () => {
  const { input, circleId, round, expectedPublicSignals } = vectors.fullCircuitExample;

  const externalNullifier = await computeExternalNullifier(BigInt(circleId), BigInt(round));
  assert.equal(externalNullifier.toString(), expectedPublicSignals.externalNullifier);
  assert.equal(externalNullifier.toString(), input.externalNullifier);

  // Walk the committed Merkle path from the leaf and confirm it reaches root.
  let node = poseidon(BigInt(input.identityNullifier), BigInt(input.identitySecret));
  for (let i = 0; i < input.pathElements.length; i++) {
    const sibling = BigInt(input.pathElements[i]);
    node = input.pathIndices[i] === 1 ? poseidon(sibling, node) : poseidon(node, sibling);
  }
  assert.equal(node.toString(), expectedPublicSignals.root);

  const nullifierHash = poseidon(BigInt(input.identityNullifier), externalNullifier);
  assert.equal(nullifierHash.toString(), expectedPublicSignals.nullifierHash);
});
