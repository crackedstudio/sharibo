import { test } from "node:test";
import assert from "node:assert/strict";
import { MerkleTree, ZERO_VALUE } from "./tree.js";
import { generateIdentity, FR_MODULUS } from "./identity.js";

const LEVELS = 4;

test("proofOf returns a valid Merkle proof for a leaf known to be in the tree", () => {
  const identities = Array.from({ length: 5 }, () => generateIdentity());
  const leaves = identities.map((id) => id.commitment);
  const tree = MerkleTree.create(LEVELS, leaves);

  const proof = tree.proofOf(leaves[2]);
  assert.equal(proof.root, tree.root);
  assert.equal(proof.pathElements.length, LEVELS);
  assert.equal(proof.pathIndices.length, LEVELS);

  // The path should match the one returned by proof(indexOf(leaf)).
  const expected = tree.proof(tree.indexOf(leaves[2]));
  assert.deepEqual(proof.pathElements, expected.pathElements);
  assert.deepEqual(proof.pathIndices, expected.pathIndices);
  assert.equal(proof.root, expected.root);
});

test("proofOf returns a valid proof for the first and last occupied leaf", () => {
  const identities = Array.from({ length: 5 }, () => generateIdentity());
  const leaves = identities.map((id) => id.commitment);
  const tree = MerkleTree.create(LEVELS, leaves);

  for (const leaf of [leaves[0], leaves[identities.length - 1]]) {
    const proof = tree.proofOf(leaf);
    assert.equal(proof.root, tree.root);
    assert.equal(proof.pathElements.length, LEVELS);
  }
});

test("proofOf throws a descriptive error for a leaf not in the tree", () => {
  const identities = Array.from({ length: 5 }, () => generateIdentity());
  const leaves = identities.map((id) => id.commitment);
  const tree = MerkleTree.create(LEVELS, leaves);

  const unknownLeaf = generateIdentity().commitment;
  // Make sure it really isn't in the tree.
  assert.equal(tree.indexOf(unknownLeaf), -1);

  assert.throws(
    () => tree.proofOf(unknownLeaf),
    (err: Error) => {
      return (
        err.message.includes("not found in this tree") &&
        err.message.includes("16 slots") &&
        err.message.includes("5 occupied")
      );
    },
  );
});

test("proofOf error message includes a shortened hex representation of the leaf", () => {
  const identities = Array.from({ length: 5 }, () => generateIdentity());
  const leaves = identities.map((id) => id.commitment);
  const tree = MerkleTree.create(LEVELS, leaves);

  const unknownLeaf = generateIdentity().commitment;
  assert.throws(
    () => tree.proofOf(unknownLeaf),
    (err: Error) => {
      // The error should mention "0x" (the hex prefix) and "not found"
      return err.message.startsWith("leaf 0x") && err.message.includes("not found");
    },
  );
});

test("proofOf works for a tree with a single leaf", () => {
  const identity = generateIdentity();
  const tree = MerkleTree.create(LEVELS, [identity.commitment]);

  const proof = tree.proofOf(identity.commitment);
  assert.equal(proof.root, tree.root);
  assert.equal(proof.pathElements.length, LEVELS);
});

test("proofOf throws for a leaf not in a tree that has zero occupied slots (empty)", () => {
  const tree = MerkleTree.create(LEVELS, []);
  const unknownLeaf = generateIdentity().commitment;

  assert.throws(
    () => tree.proofOf(unknownLeaf),
    (err: Error) => {
      return (
        err.message.includes("not found in this tree") &&
        err.message.includes("0 occupied")
      );
    },
  );
});

// ---- levels validation ----

test("MerkleTree.create rejects levels = 0", () => {
  assert.throws(
    () => MerkleTree.create(0, []),
    RangeError,
    "levels must be an integer >= 1",
  );
});

test("MerkleTree.create rejects negative levels", () => {
  assert.throws(
    () => MerkleTree.create(-1, []),
    RangeError,
    "levels must be an integer >= 1",
  );
});

test("MerkleTree.create rejects fractional levels", () => {
  assert.throws(
    () => MerkleTree.create(0.5, []),
    RangeError,
    "levels must be an integer >= 1",
  );
});

test("MerkleTree.create rejects NaN levels", () => {
  assert.throws(
    () => MerkleTree.create(NaN, []),
    RangeError,
    "levels must be an integer >= 1",
  );
});

test("MerkleTree.create rejects levels > 32", () => {
  assert.throws(
    () => MerkleTree.create(33, []),
    RangeError,
    "levels must be <= 32",
  );
});

test("MerkleTree.create accepts levels = 1 (minimal tree)", () => {
  const tree = MerkleTree.create(1, [42n]);
  assert.ok(tree instanceof MerkleTree);
  assert.equal(tree.levels, 1);
});

test("MerkleTree.create accepts levels = 10 (safe upper bound)", () => {
  // 2^10 = 1024 leaves — fast enough for a unit test, and exercises the
  // full tree construction path including Poseidon hashing at every level.
  // The 32-level cap is tested by the rejection test above; constructing
  // a tree near that cap is infeasible in a test runner.
  const tree = MerkleTree.create(10, []);
  assert.ok(tree instanceof MerkleTree);
  assert.equal(tree.levels, 10);
  assert.ok(typeof tree.root === "bigint");
});

// ---- leaf validation ----

test("MerkleTree.create rejects a negative leaf", () => {
  assert.throws(
    () => MerkleTree.create(4, [-1n]),
    RangeError,
    "leaf at index 0 must satisfy 0 <= leaf < FR_MODULUS",
  );
});

test("MerkleTree.create rejects leaf >= FR_MODULUS", () => {
  assert.throws(
    () => MerkleTree.create(4, [FR_MODULUS]),
    RangeError,
    "leaf at index 0 must satisfy 0 <= leaf < FR_MODULUS",
  );
});

test("MerkleTree.create rejects leaf > FR_MODULUS", () => {
  assert.throws(
    () => MerkleTree.create(4, [FR_MODULUS + 1n]),
    RangeError,
    "leaf at index 0 must satisfy 0 <= leaf < FR_MODULUS",
  );
});

test("MerkleTree.create accepts leaf = 0n (lower bound)", () => {
  const tree = MerkleTree.create(4, [0n]);
  assert.ok(tree instanceof MerkleTree);
});

test("MerkleTree.create accepts leaf = FR_MODULUS - 1n (upper bound)", () => {
  const tree = MerkleTree.create(4, [FR_MODULUS - 1n]);
  assert.ok(tree instanceof MerkleTree);
});

test("MerkleTree.create reports the correct index for a rejected leaf", () => {
  // Validate that rejections name the offending index, not just the value.
  assert.throws(
    () => MerkleTree.create(4, [42n, 1n, FR_MODULUS, 7n]),
    (err: unknown) => {
      assert.ok(err instanceof RangeError);
      const msg = (err as RangeError).message;
      // The bad leaf is at index 2.
      return msg.includes("index 2") && msg.includes(String(FR_MODULUS));
    },
  );
});

// ---- zero leaves with valid levels (padded to ZERO_VALUE) ----

test("MerkleTree.create with zero leaves produces a padded tree", () => {
  // When no leaves are provided, the tree is padded entirely with ZERO_VALUE
  // to fill all 2**levels slots. indexOf only searches the *original* leaves
  // array (see tree.ts), so ZERO_VALUE won't be found here. We verify the
  // tree is constructed correctly by checking the root is a well-formed
  // bigint.
  const tree = MerkleTree.create(3, []);
  assert.ok(tree instanceof MerkleTree);
  assert.ok(typeof tree.root === "bigint");
});
