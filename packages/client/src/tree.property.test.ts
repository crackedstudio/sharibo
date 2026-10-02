import { test, expect } from "vitest";
import fc from "fast-check";
import { FR_MODULUS } from "./identity.js";
import { feToBytes } from "./prove.js";
import { referenceVerify } from "./tree.reference.js";
import { MerkleTree } from "./tree.js";

// BLS12-381 base-field modulus used by the compressed contract point encoding.
const FP_MODULUS =
  0x1a0111ea397fe69a4b1ba7b6434bacd7_64774b84f38512bf_6730d2a0f6b0f624_1eabfffeb153ffff_b9feffffffffaaabn;

const scalar = fc.bigInt({ min: 0n, max: FR_MODULUS - 1n });

test("every generated Merkle proof verifies for depths 1 through 6", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 6 }),
      fc.array(scalar, { minLength: 1, maxLength: 64 }),
      (levels, generatedLeaves) => {
        const leaves = generatedLeaves.slice(0, 2 ** levels);
        const tree = MerkleTree.create(levels, leaves);

        return leaves.every((leaf, index) => referenceVerify(leaf, tree.proof(index)));
      },
    ),
    { seed: 490049, numRuns: 100 },
  );
});

test("different leaf sets produce different roots", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 6 }),
      fc.array(scalar, { minLength: 1, maxLength: 64 }),
      (levels, generatedLeaves) => {
        const left = generatedLeaves.slice(0, 2 ** levels);
        const right = [...left];
        right[0] = (right[0] + 1n) % FR_MODULUS;

        return MerkleTree.create(levels, left).root !== MerkleTree.create(levels, right).root;
      },
    ),
    { seed: 490050, numRuns: 100 },
  );
});

test("valid base-field elements encode to 48 bytes and round-trip", () => {
  fc.assert(
    fc.property(fc.bigInt({ min: 0n, max: FP_MODULUS - 1n }), (value) => {
      const encoded = feToBytes(value.toString());
      const decoded = BigInt(
        `0x${Array.from(encoded, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
      );

      expect(encoded).toHaveLength(48);
      return decoded === value;
    }),
    { seed: 490051, numRuns: 100 },
  );
});
