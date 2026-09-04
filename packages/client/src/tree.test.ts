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

// ─────────────────────────────────────────────────────────────────────────────
// Existing unit tests (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

const LEVELS = 4;

describe("MerkleTree.proofOf", () => {
  it("returns a valid Merkle proof for a leaf known to be in the tree", () => {
    const identities = Array.from({ length: 5 }, () => generateIdentity());
    const leaves = identities.map((id) => id.commitment);
    const tree = MerkleTree.create(LEVELS, leaves);

    const proof = tree.proofOf(leaves[2]);
    expect(proof.root).toBe(tree.root);
    expect(proof.pathElements).toHaveLength(LEVELS);
    expect(proof.pathIndices).toHaveLength(LEVELS);

    const expected = tree.proof(tree.indexOf(leaves[2]));
    expect(proof.pathElements).toEqual(expected.pathElements);
    expect(proof.pathIndices).toEqual(expected.pathIndices);
    expect(proof.root).toBe(expected.root);
  });

  it("returns a valid proof for the first and last occupied leaf", () => {
    const identities = Array.from({ length: 5 }, () => generateIdentity());
    const leaves = identities.map((id) => id.commitment);
    const tree = MerkleTree.create(LEVELS, leaves);

    for (const leaf of [leaves[0], leaves[identities.length - 1]]) {
      const proof = tree.proofOf(leaf);
      expect(proof.root).toBe(tree.root);
      expect(proof.pathElements).toHaveLength(LEVELS);
    }
  });

  it("throws a descriptive error for a leaf not in the tree", () => {
    const identities = Array.from({ length: 5 }, () => generateIdentity());
    const leaves = identities.map((id) => id.commitment);
    const tree = MerkleTree.create(LEVELS, leaves);

    const unknownLeaf = generateIdentity().commitment;
    expect(tree.indexOf(unknownLeaf)).toBe(-1);

    expect(() => tree.proofOf(unknownLeaf)).toThrow(
      (err: Error) =>
        err.message.includes("not found in this tree") &&
        err.message.includes("16 slots") &&
        err.message.includes("5 occupied"),
    );
  });

  it("error message includes a shortened hex representation of the leaf", () => {
    const identities = Array.from({ length: 5 }, () => generateIdentity());
    const leaves = identities.map((id) => id.commitment);
    const tree = MerkleTree.create(LEVELS, leaves);

    const unknownLeaf = generateIdentity().commitment;
    expect(() => tree.proofOf(unknownLeaf)).toThrow(
      (err: Error) =>
        err.message.startsWith("leaf 0x") && err.message.includes("not found"),
    );
  });

  it("works for a tree with a single leaf", () => {
    const identity = generateIdentity();
    const tree = MerkleTree.create(LEVELS, [identity.commitment]);

    const proof = tree.proofOf(identity.commitment);
    expect(proof.root).toBe(tree.root);
    expect(proof.pathElements).toHaveLength(LEVELS);
  });

  it("throws for a leaf not in a tree that has zero occupied slots (empty)", () => {
    const tree = MerkleTree.create(LEVELS, []);
    const unknownLeaf = generateIdentity().commitment;

    expect(() => tree.proofOf(unknownLeaf)).toThrow(
      (err: Error) =>
        err.message.includes("not found in this tree") &&
        err.message.includes("0 occupied"),
    );
  });
});

// ---- levels validation ----

// ─────────────────────────────────────────────────────────────────────────────
// MerkleTree.create — levels validation
// ─────────────────────────────────────────────────────────────────────────────

describe("MerkleTree.create — levels validation", () => {
  it("rejects levels = 0", () => {
    expect(() => MerkleTree.create(0, [])).toThrow(RangeError);
  });

  it("rejects negative levels", () => {
    expect(() => MerkleTree.create(-1, [])).toThrow(RangeError);
  });

  it("rejects fractional levels", () => {
    expect(() => MerkleTree.create(0.5, [])).toThrow(RangeError);
  });

  it("rejects NaN levels", () => {
    expect(() => MerkleTree.create(NaN, [])).toThrow(RangeError);
  });

  it("rejects levels > 32", () => {
    expect(() => MerkleTree.create(33, [])).toThrow(RangeError);
  });

  it("accepts levels = 1 (minimal tree)", () => {
    const tree = MerkleTree.create(1, [42n]);
    expect(tree).toBeInstanceOf(MerkleTree);
    expect(tree.levels).toBe(1);
  });

  it("accepts levels = 10", () => {
    const tree = MerkleTree.create(10, []);
    expect(tree).toBeInstanceOf(MerkleTree);
    expect(tree.levels).toBe(10);
    expect(typeof tree.root).toBe("bigint");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MerkleTree.create — leaf validation
// ─────────────────────────────────────────────────────────────────────────────

describe("MerkleTree.create — leaf validation", () => {
  it("rejects a negative leaf", () => {
    expect(() => MerkleTree.create(4, [-1n])).toThrow(RangeError);
  });

  it("rejects leaf >= FR_MODULUS", () => {
    expect(() => MerkleTree.create(4, [FR_MODULUS])).toThrow(RangeError);
  });

  it("rejects leaf > FR_MODULUS", () => {
    expect(() => MerkleTree.create(4, [FR_MODULUS + 1n])).toThrow(RangeError);
  });

  it("accepts leaf = 0n (lower bound)", () => {
    expect(MerkleTree.create(4, [0n])).toBeInstanceOf(MerkleTree);
  });

  it("accepts leaf = FR_MODULUS - 1n (upper bound)", () => {
    expect(MerkleTree.create(4, [FR_MODULUS - 1n])).toBeInstanceOf(MerkleTree);
  });

  it("reports the correct index for a rejected leaf", () => {
    expect(() => MerkleTree.create(4, [42n, 1n, FR_MODULUS, 7n])).toThrow(
      (err: unknown) => {
        if (!(err instanceof RangeError)) return false;
        return err.message.includes("index 2") && err.message.includes(String(FR_MODULUS));
      },
    );
  });

  it("with zero leaves produces a padded tree", () => {
    const tree = MerkleTree.create(3, []);
    expect(tree).toBeInstanceOf(MerkleTree);
    expect(typeof tree.root).toBe("bigint");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Arbitraries shared by the differential test suite
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A fast-check arbitrary for a non-zero BLS12-381 scalar field element.
 *
 * We exclude 0n deliberately: ZERO_VALUE = 0n is the padding sentinel, and
 * MerkleTree.indexOf only searches the *original* (unpadded) leaves array.
 * A real leaf of 0n would be indistinguishable from a padding slot for any
 * caller using indexOf/proofOf, which is a known, documented limitation of
 * the current implementation.  Keeping leaves > 0 in the fuzz keeps the
 * differential test focused on the index / path-direction logic rather than
 * that edge case.
 */
const arbFieldElement: fc.Arbitrary<bigint> = fc.bigInt({
  min: 1n,
  max: FR_MODULUS - 1n,
});

/**
 * An arbitrary (levels, leaves[]) pair that is always within tree capacity
 * and uses levels in the range 1–8 (depth 8 → 256 leaves, still fast).
 * At least one leaf is always generated so every case exercises a proof call.
 */
const arbTreeInput: fc.Arbitrary<{ levels: number; leaves: bigint[] }> = fc
  .integer({ min: 1, max: 8 })
  .chain((levels) => {
    const capacity = 2 ** levels;
    return fc
      .array(arbFieldElement, { minLength: 1, maxLength: capacity })
      .map((leaves) => ({ levels, leaves }));
  });

// ─────────────────────────────────────────────────────────────────────────────
// Differential properties
// ─────────────────────────────────────────────────────────────────────────────

describe("MerkleTree differential — production vs naive reference", () => {
  /**
   * Property 1 — Root agreement.
   *
   * Both implementations must compute the same root for any (levels, leaves)
   * pair.  A mismatch means one has the wrong padding rule or wrong hash
   * order.
   */
  it(
    "roots are identical across all depths 1–8 (≥200 cases)",
    () => {
      fc.assert(
        fc.property(arbTreeInput, ({ levels, leaves }) => {
          const prodRoot = MerkleTree.create(levels, leaves).root;
          const refRoot = referenceRoot(levels, leaves);
          expect(prodRoot).toBe(refRoot);
        }),
        {
          numRuns: 200,
          // Fixed seed → deterministic CI runs; delete or change to explore.
          seed: 0xdeadbeef,
          verbose: true,
        },
      );
    },
    // Poseidon is not cheap; allow extra time at depth 8 (256 leaves × 8
    // levels ≈ 2048 hash calls per case × 200 cases).
    { timeout: 60_000 },
  );

  /**
   * Property 2 — Proof agreement.
   *
   * For every leaf in the tree, both implementations must produce the same
   * pathElements and pathIndices.  A mismatch here is exactly the class of
   * off-by-one or sibling-order bug that produces a valid-looking proof that
   * the circuit silently rejects.
   */
  it(
    "pathElements and pathIndices are identical for every leaf, all depths 1–8 (≥200 cases)",
    () => {
      fc.assert(
        fc.property(arbTreeInput, ({ levels, leaves }) => {
          const prodTree = MerkleTree.create(levels, leaves);

          for (let i = 0; i < leaves.length; i++) {
            const prod = prodTree.proof(i);
            const ref = referenceProof(levels, leaves, i);

            expect(prod.root).toBe(ref.root);
            expect(prod.pathElements).toEqual(ref.pathElements);
            expect(prod.pathIndices).toEqual(ref.pathIndices);
          }
        }),
        { numRuns: 200, seed: 0xdeadbeef, verbose: true },
      );
    },
    { timeout: 60_000 },
  );

  /**
   * Property 3 — Proof self-consistency (reference verifier).
   *
   * Every proof produced by either implementation must pass referenceVerify
   * when hashed from its own leaf back to the root.  This checks that the
   * (left, right) convention inside referenceVerify matches MerkleTreeChecker
   * — without needing to run the circuit.
   */
  it(
    "every proof verifies against its own root via referenceVerify (≥200 cases)",
    () => {
      fc.assert(
        fc.property(arbTreeInput, ({ levels, leaves }) => {
          for (let i = 0; i < leaves.length; i++) {
            const proof = referenceProof(levels, leaves, i);
            expect(referenceVerify(leaves[i], proof)).toBe(true);
          }
        }),
        { numRuns: 200, seed: 0xdeadbeef, verbose: true },
      );
    },
    { timeout: 60_000 },
  );

  /**
   * Property 4 — Cross-verification.
   *
   * Proofs from the *production* tree must also pass the *reference*
   * verifier.  This is an independent cross-check direction from Property 2.
   */
  it(
    "production-tree proofs pass referenceVerify (≥200 cases)",
    () => {
      fc.assert(
        fc.property(arbTreeInput, ({ levels, leaves }) => {
          const prodTree = MerkleTree.create(levels, leaves);

          for (let i = 0; i < leaves.length; i++) {
            const proof = prodTree.proof(i);
            expect(referenceVerify(leaves[i], proof)).toBe(true);
          }
        }),
        { numRuns: 200, seed: 0xdeadbeef, verbose: true },
      );
    },
    { timeout: 60_000 },
  );

  /**
   * Property 5 — Tampered-proof rejection.
   *
   * Flipping any single pathElement must cause referenceVerify to return
   * false.  This guards against a vacuously-true verifier.
   */
  it(
    "referenceVerify rejects proofs with a tampered pathElement (≥100 cases)",
    () => {
      fc.assert(
        fc.property(
          // Fix levels at 3 for speed; depth correctness is covered above.
          fc
            .array(arbFieldElement, { minLength: 1, maxLength: 8 })
            .map((leaves) => ({ levels: 3, leaves })),
          fc.integer({ min: 0 }),
          ({ levels, leaves }, seed) => {
            const i = seed % leaves.length;
            const proof = referenceProof(levels, leaves, i);

            const tampered = {
              ...proof,
              pathElements: proof.pathElements.map((e, j) =>
                j === 0 ? e + 1n : e,
              ),
            };

            expect(referenceVerify(leaves[i], tampered)).toBe(false);
          },
        ),
        { numRuns: 100, seed: 0xdeadbeef },
      );
    },
    { timeout: 30_000 },
  );

  /**
   * Property 6 — Padding isolation.
   *
   * Explicitly appending ZERO_VALUE to a leaf set must produce the same root
   * as leaving that slot implicitly padded.  Validates that the production
   * tree's padding rule is consistent.
   */
  it(
    "explicit ZERO_VALUE padding produces the same root as implicit padding (≥100 cases)",
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 6 }),
          fc.integer({ min: 1, max: 8 }),
          (levels, leafCount) => {
            const capacity = 2 ** levels;
            const count = Math.min(leafCount, capacity - 1); // leave at least one empty slot
            const leaves = Array.from({ length: count }, (_, i) => BigInt(i + 1));

            const implicit = MerkleTree.create(levels, leaves).root;
            const explicit = MerkleTree.create(levels, [...leaves, ZERO_VALUE]).root;
            expect(implicit).toBe(explicit);
          },
        ),
        { numRuns: 100, seed: 0xdeadbeef },
      );
    },
    { timeout: 30_000 },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Pinned depth-coverage checks
// ─────────────────────────────────────────────────────────────────────────────
// Cheap deterministic cases that guarantee exactly one run at every depth from
// 1 to 8, independent of the random seed.  These complement the property tests
// above but are not a substitute for them.

describe("MerkleTree differential — pinned depth coverage", () => {
  for (const levels of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`depth ${levels}: root and all proofs match the reference`, () => {
      const capacity = 2 ** levels;
      const count = Math.max(1, Math.floor(capacity / 2));
      const leaves = Array.from({ length: count }, (_, i) => BigInt(i + 1));

      const prodTree = MerkleTree.create(levels, leaves);
      expect(prodTree.root).toBe(referenceRoot(levels, leaves));

      for (let i = 0; i < leaves.length; i++) {
        const prod = prodTree.proof(i);
        const ref = referenceProof(levels, leaves, i);
        expect(prod.root).toBe(ref.root);
        expect(prod.pathElements).toEqual(ref.pathElements);
        expect(prod.pathIndices).toEqual(ref.pathIndices);
        expect(referenceVerify(leaves[i], prod)).toBe(true);
      }
    });
  }
});
