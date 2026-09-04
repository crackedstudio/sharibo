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

// ── MerkleTree.create — levels validation ─────────────────────────────────────

describe("MerkleTree.create — levels validation", () => {
  it("rejects levels = 0", () => {
    expect(() => MerkleTree.create(0, [])).toThrow(RangeError);
  });

  it("rejects negative levels", () => {
    expect(() => MerkleTree.create(-1, [])).toThrow(RangeError);
  });

  it("rejects fractional levels (0.5)", () => {
    expect(() => MerkleTree.create(0.5, [])).toThrow(RangeError);
  });

  it("rejects NaN", () => {
    expect(() => MerkleTree.create(NaN, [])).toThrow(RangeError);
  });

  it("rejects levels > 32", () => {
    expect(() => MerkleTree.create(33, [])).toThrow(RangeError);
  });

  it("accepts levels = 1", () => {
    const t = MerkleTree.create(1, [42n]);
    expect(t.levels).toBe(1);
  });

  it("accepts levels = 10", () => {
    const t = MerkleTree.create(10, []);
    expect(t.levels).toBe(10);
    expect(typeof t.root).toBe("bigint");
  });
});

// ── MerkleTree.create — leaf validation ──────────────────────────────────────

describe("MerkleTree.create — leaf validation", () => {
  it("rejects a negative leaf", () => {
    expect(() => MerkleTree.create(4, [-1n])).toThrow(RangeError);
  });

  it("rejects leaf = FR_MODULUS", () => {
    expect(() => MerkleTree.create(4, [FR_MODULUS])).toThrow(RangeError);
  });

  it("rejects leaf > FR_MODULUS", () => {
    expect(() => MerkleTree.create(4, [FR_MODULUS + 1n])).toThrow(RangeError);
  });

  it("accepts leaf = 0n", () => {
    expect(() => MerkleTree.create(4, [0n])).not.toThrow();
  });

  it("accepts leaf = FR_MODULUS - 1n", () => {
    expect(() => MerkleTree.create(4, [FR_MODULUS - 1n])).not.toThrow();
  });

  it("error message names the offending index", () => {
    expect(() => MerkleTree.create(4, [42n, 1n, FR_MODULUS, 7n])).toThrow(
      /index 2/,
    );
  });

  it("rejects too many leaves for the given depth", () => {
    // levels=2 → capacity 4; 5 leaves must be rejected.
    expect(() => MerkleTree.create(2, [1n, 2n, 3n, 4n, 5n])).toThrow();
  });
});

// ── Root correctness ──────────────────────────────────────────────────────────

describe("MerkleTree root correctness", () => {
  it("root of a single-leaf depth-1 tree equals poseidon(leaf, ZERO_VALUE)", () => {
    // levels=1 → two slots. Slot 0 = leaf, slot 1 = ZERO_VALUE.
    // The single parent node = poseidon(leaves[0], leaves[1]).
    const leaf = LEAF_A;
    const tree = MerkleTree.create(1, [leaf]);
    expect(tree.root).toBe(poseidon(leaf, ZERO_VALUE));
  });

  it("root of a full depth-1 tree equals poseidon(left, right)", () => {
    const tree = MerkleTree.create(1, [LEAF_A, LEAF_B]);
    expect(tree.root).toBe(poseidon(LEAF_A, LEAF_B));
  });

  it("root of a full depth-2 tree is computed from the correct layer order", () => {
    // 4 leaves: [A, B, C, D]
    // Layer 0: [A, B, C, D]
    // Layer 1: [poseidon(A,B), poseidon(C,D)]
    // Layer 2 (root): poseidon(poseidon(A,B), poseidon(C,D))
    const tree = MerkleTree.create(2, [LEAF_A, LEAF_B, LEAF_C, LEAF_D]);
    const expectedRoot = poseidon(
      poseidon(LEAF_A, LEAF_B),
      poseidon(LEAF_C, LEAF_D),
    );
    expect(tree.root).toBe(expectedRoot);
  });

  it("root of a depth-2 tree with 2 leaves pads with ZERO_VALUE", () => {
    // 2 leaves: [A, B, ZERO, ZERO]
    // Layer 1: [poseidon(A,B), poseidon(ZERO,ZERO)]
    // Root: poseidon(poseidon(A,B), poseidon(ZERO,ZERO))
    const tree = MerkleTree.create(2, [LEAF_A, LEAF_B]);
    const expectedRoot = poseidon(
      poseidon(LEAF_A, LEAF_B),
      poseidon(ZERO_VALUE, ZERO_VALUE),
    );
    expect(tree.root).toBe(expectedRoot);
  });

  it("two trees with different leaves have different roots", () => {
    const treeA = MerkleTree.create(2, [LEAF_A, LEAF_B]);
    const treeB = MerkleTree.create(2, [LEAF_A, LEAF_C]);
    expect(treeA.root).not.toBe(treeB.root);
  });

  it("root changes when a leaf changes position", () => {
    // [A, B] and [B, A] should have different roots because Poseidon is not
    // commutative, so position matters.
    const treeAB = MerkleTree.create(1, [LEAF_A, LEAF_B]);
    const treeBA = MerkleTree.create(1, [LEAF_B, LEAF_A]);
    expect(treeAB.root).not.toBe(treeBA.root);
  });
});

// ── proof — pathIndices correctness ───────────────────────────────────────────

describe("MerkleTree.proof — pathIndices direction", () => {
  it("leaf at an even index has pathIndices[0] = 0 (it is the LEFT child)", () => {
    // Leaf at index 0 is the left child; its sibling is index 1.
    const tree = MerkleTree.create(2, [LEAF_A, LEAF_B, LEAF_C, LEAF_D]);
    const proof = tree.proof(0);
    expect(proof.pathIndices[0]).toBe(0);
  });

  it("leaf at an odd index has pathIndices[0] = 1 (it is the RIGHT child)", () => {
    // Leaf at index 1 is the right child; its sibling is index 0.
    const tree = MerkleTree.create(2, [LEAF_A, LEAF_B, LEAF_C, LEAF_D]);
    const proof = tree.proof(1);
    expect(proof.pathIndices[0]).toBe(1);
  });

  it("leaf at index 2 has pathIndices[0]=0, pathIndices[1]=1", () => {
    // Index 2: left child of its pair → index[0] = 0.
    // Its parent is at layer-1 index 1 (odd) → right child → index[1] = 1.
    const tree = MerkleTree.create(2, [LEAF_A, LEAF_B, LEAF_C, LEAF_D]);
    const proof = tree.proof(2);
    expect(proof.pathIndices[0]).toBe(0);
    expect(proof.pathIndices[1]).toBe(1);
  });

  it("leaf at index 3 has pathIndices[0]=1, pathIndices[1]=1", () => {
    // Index 3: right child of its pair → index[0] = 1.
    // Its parent is at layer-1 index 1 (odd) → right child → index[1] = 1.
    const tree = MerkleTree.create(2, [LEAF_A, LEAF_B, LEAF_C, LEAF_D]);
    const proof = tree.proof(3);
    expect(proof.pathIndices[0]).toBe(1);
    expect(proof.pathIndices[1]).toBe(1);
  });
});

// ── proof — sibling (pathElements) correctness ───────────────────────────────

describe("MerkleTree.proof — sibling selection", () => {
  it("sibling of the left child (index 0) is the right child (index 1) at level 0", () => {
    const tree = MerkleTree.create(2, [LEAF_A, LEAF_B, LEAF_C, LEAF_D]);
    const proof = tree.proof(0); // leaf A, sibling is B
    expect(proof.pathElements[0]).toBe(LEAF_B);
  });

  it("sibling of the right child (index 1) is the left child (index 0) at level 0", () => {
    const tree = MerkleTree.create(2, [LEAF_A, LEAF_B, LEAF_C, LEAF_D]);
    const proof = tree.proof(1); // leaf B, sibling is A
    expect(proof.pathElements[0]).toBe(LEAF_A);
  });

  it("sibling of leaf at index 2 is leaf at index 3 at level 0", () => {
    const tree = MerkleTree.create(2, [LEAF_A, LEAF_B, LEAF_C, LEAF_D]);
    const proof = tree.proof(2); // leaf C, sibling is D
    expect(proof.pathElements[0]).toBe(LEAF_D);
  });

  it("sibling of leaf at index 3 is leaf at index 2 at level 0", () => {
    const tree = MerkleTree.create(2, [LEAF_A, LEAF_B, LEAF_C, LEAF_D]);
    const proof = tree.proof(3); // leaf D, sibling is C
    expect(proof.pathElements[0]).toBe(LEAF_C);
  });

  it("level-1 sibling of leaf 0 is poseidon(C, D)", () => {
    // At level 1, leaf-0's parent is poseidon(A,B). Its sibling is poseidon(C,D).
    const tree = MerkleTree.create(2, [LEAF_A, LEAF_B, LEAF_C, LEAF_D]);
    const proof = tree.proof(0);
    expect(proof.pathElements[1]).toBe(poseidon(LEAF_C, LEAF_D));
  });

  it("level-1 sibling of leaf 2 is poseidon(A, B)", () => {
    // At level 1, leaf-2's parent is poseidon(C,D). Its sibling is poseidon(A,B).
    const tree = MerkleTree.create(2, [LEAF_A, LEAF_B, LEAF_C, LEAF_D]);
    const proof = tree.proof(2);
    expect(proof.pathElements[1]).toBe(poseidon(LEAF_A, LEAF_B));
  });

  it("sibling of a leaf with no right neighbour is ZERO_VALUE", () => {
    // 3 leaves in a depth-2 tree: [A, B, C, ZERO]
    // Leaf at index 2 (C) — its right sibling (index 3) is ZERO_VALUE.
    const tree = MerkleTree.create(2, [LEAF_A, LEAF_B, LEAF_C]);
    const proof = tree.proof(2);
    expect(proof.pathElements[0]).toBe(ZERO_VALUE);
  });
});

// ── proof — root reconstruction ───────────────────────────────────────────────

describe("MerkleTree.proof — root reconstruction via circuit formula", () => {
  it("recomputeRoot matches tree.root for every leaf position (depth-2, 4 leaves)", () => {
    const leaves = [LEAF_A, LEAF_B, LEAF_C, LEAF_D];
    const tree = MerkleTree.create(2, leaves);
    for (let i = 0; i < leaves.length; i++) {
      const { pathElements, pathIndices, root } = tree.proof(i);
      const computed = recomputeRoot(leaves[i], pathElements, pathIndices);
      expect(computed).toBe(root);
      expect(computed).toBe(tree.root);
    }
  });

  it("recomputeRoot matches tree.root for every leaf (depth-3, 5 real leaves)", () => {
    const leaves = Array.from({ length: 5 }, (_, i) => BigInt(i + 1));
    const tree = MerkleTree.create(3, leaves);
    for (let i = 0; i < leaves.length; i++) {
      const { pathElements, pathIndices, root } = tree.proof(i);
      expect(recomputeRoot(leaves[i], pathElements, pathIndices)).toBe(root);
    }
  });

  it("recomputeRoot matches tree.root using generateIdentity commitments", () => {
    // Exercises the path with real-looking field elements (commitments are
    // valid Poseidon outputs, not small integers).
    const identities = Array.from({ length: 5 }, () => generateIdentity());
    const leaves = identities.map((id) => id.commitment);
    const tree = MerkleTree.create(4, leaves);
    for (let i = 0; i < leaves.length; i++) {
      const { pathElements, pathIndices, root } = tree.proof(i);
      expect(recomputeRoot(leaves[i], pathElements, pathIndices)).toBe(root);
    }
  });

  it("a swapped pathElements[0] fails reconstruction", () => {
    // Confirms the test helper catches a mutation that swaps two siblings.
    const tree = MerkleTree.create(2, [LEAF_A, LEAF_B, LEAF_C, LEAF_D]);
    const { pathElements, pathIndices } = tree.proof(0);
    const tampered = [pathElements[1], pathElements[0], ...pathElements.slice(2)];
    expect(recomputeRoot(LEAF_A, tampered, pathIndices)).not.toBe(tree.root);
  });

  it("a flipped pathIndices[0] fails reconstruction", () => {
    // Confirms a direction-bit mutation is detectable.
    const tree = MerkleTree.create(2, [LEAF_A, LEAF_B, LEAF_C, LEAF_D]);
    const { pathElements, pathIndices } = tree.proof(0);
    const tampered = [pathIndices[0] === 0 ? 1 : 0, ...pathIndices.slice(1)];
    expect(recomputeRoot(LEAF_A, pathElements, tampered)).not.toBe(tree.root);
  });
});

// ── proof — length and shape ──────────────────────────────────────────────────

describe("MerkleTree.proof — output shape", () => {
  it("pathElements length equals tree.levels", () => {
    const tree = MerkleTree.create(4, [LEAF_A, LEAF_B]);
    expect(tree.proof(0).pathElements.length).toBe(4);
  });

  it("pathIndices length equals tree.levels", () => {
    const tree = MerkleTree.create(4, [LEAF_A, LEAF_B]);
    expect(tree.proof(0).pathIndices.length).toBe(4);
  });

  it("pathIndices values are only 0 or 1", () => {
    const tree = MerkleTree.create(4, [LEAF_A, LEAF_B, LEAF_C, LEAF_D]);
    for (let i = 0; i < 4; i++) {
      for (const idx of tree.proof(i).pathIndices) {
        expect([0, 1]).toContain(idx);
      }
    }
  });

  it("proof returns the correct root", () => {
    const tree = MerkleTree.create(4, [LEAF_A, LEAF_B]);
    expect(tree.proof(0).root).toBe(tree.root);
  });

  it("throws for a negative leaf index", () => {
    const tree = MerkleTree.create(4, [LEAF_A]);
    expect(() => tree.proof(-1)).toThrow();
  });

  it("throws for a leaf index >= capacity", () => {
    const tree = MerkleTree.create(2, [LEAF_A]); // capacity = 4
    expect(() => tree.proof(4)).toThrow();
  });
});

// ── indexOf ───────────────────────────────────────────────────────────────────

describe("MerkleTree.indexOf", () => {
  it("returns the correct index for a known leaf", () => {
    const tree = MerkleTree.create(4, [LEAF_A, LEAF_B, LEAF_C]);
    expect(tree.indexOf(LEAF_B)).toBe(1);
  });

  it("returns -1 for a leaf not in the tree", () => {
    const tree = MerkleTree.create(4, [LEAF_A]);
    expect(tree.indexOf(LEAF_D)).toBe(-1);
  });

  it("does NOT find ZERO_VALUE as a leaf (padded slots are invisible)", () => {
    // The original leaves array passed to create() has only real values;
    // padded zeros must not appear as findable leaves.
    const tree = MerkleTree.create(4, [LEAF_A]);
    expect(tree.indexOf(ZERO_VALUE)).toBe(-1);
  });
});

// ── proof via indexOf — convenience pattern ───────────────────────────────────

describe("MerkleTree — proof via indexOf", () => {
  it("proof(indexOf(leaf)) produces a valid path for a known leaf", () => {
    const identities = Array.from({ length: 5 }, () => generateIdentity());
    const leaves = identities.map((id) => id.commitment);
    const tree = MerkleTree.create(4, leaves);

    const idx = tree.indexOf(leaves[2]);
    expect(idx).not.toBe(-1);
    const proof = tree.proof(idx);
    expect(proof.root).toBe(tree.root);
    expect(proof.pathElements.length).toBe(4);
    expect(proof.pathIndices.length).toBe(4);
  });

  it("proof(indexOf(leaf)) passes recomputeRoot for all 5 leaves", () => {
    const identities = Array.from({ length: 5 }, () => generateIdentity());
    const leaves = identities.map((id) => id.commitment);
    const tree = MerkleTree.create(4, leaves);

    for (const leaf of leaves) {
      const idx = tree.indexOf(leaf);
      const { pathElements, pathIndices, root } = tree.proof(idx);
      expect(recomputeRoot(leaf, pathElements, pathIndices)).toBe(root);
    }
  });

  it("works for the first and last occupied leaf", () => {
    const leaves = [LEAF_A, LEAF_B, LEAF_C, LEAF_D, 5n];
    const tree = MerkleTree.create(4, leaves);
    for (const leaf of [LEAF_A, 5n]) {
      const idx = tree.indexOf(leaf);
      expect(tree.proof(idx).root).toBe(tree.root);
    }
  });
});
