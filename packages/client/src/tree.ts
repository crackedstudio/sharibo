import { poseidon, FR_MODULUS } from "./identity.js";
import { InvalidInputError } from "./errors.js";

// Must match `component main = Sharibo(4)` in circuits/membership.circom
// (generated from circuits/config.json). The circuit is the source of truth.
// No `node:*` imports — this file runs unmodified in both Node and the browser.
export const TREE_LEVELS = 4;
export const MAX_CIRCLE_SIZE = 2 ** TREE_LEVELS;

/**
 * Fixed placeholder for unused leaves when padding the tree out to full capacity (2**levels).
 *
 * 0 can never equal a real commitment Poseidon(a, b) for field elements a, b
 * sampled the way generateIdentity() does it, so there's no collision risk for
 * this demo's threat model.
 */
export const ZERO_VALUE = 0n;

/**
 * A Merkle proof for a leaf in the Merkle tree.
 *
 * @property root - The root of the Merkle tree.
 * @property pathElements - The sibling nodes along the path from leaf to root.
 * @property pathIndices - Direction indicators (0 = left child, 1 = right child) for each level.
 */
export interface MerkleProof {
  root: bigint;
  pathElements: bigint[];
  pathIndices: number[];
}

/**
 * A Merkle tree implementation for Sharibo identity commitments.
 *
 * Uses Poseidon hashing for all internal nodes. Follows the same convention
 * the circuit's MerkleTreeChecker uses: pathIndices[i] = 1 means the current
 * node is the RIGHT child at that level (sibling is to its left),
 * pathIndices[i] = 0 means it's the LEFT child.
 */
export class MerkleTree {
  /** The number of levels in the tree. */
  readonly levels: number;
  private readonly leaves: readonly bigint[];
  private readonly layers: readonly bigint[][];

  private constructor(levels: number, leaves: bigint[], layers: bigint[][]) {
    this.levels = levels;
    this.leaves = leaves;
    this.layers = layers;
  }

  /**
   * Creates a new Merkle tree with the given leaves.
   *
   * @param levels - The number of levels in the tree (capacity = 2^levels).
   * @param leaves - The leaf values (identity commitments).
   * @returns A new MerkleTree instance.
   * @throws {RangeError} If levels is not a valid integer in [1, 32].
   * @throws {RangeError} If any leaf is outside [0, FR_MODULUS).
   * @throws {InvalidInputError} If the number of leaves exceeds the tree capacity.
   */
  static create(levels: number, leaves: bigint[]): MerkleTree {
    // Validate `levels` before computing capacity (Issue #50).
    // `Number.isInteger` rejects NaN, Infinity, and fractional values like 0.5,
    // all of which would otherwise produce a nonsensical capacity (e.g.
    // 2 ** 0.5 === 1.414…, 2 ** Infinity === Infinity).
    if (!Number.isInteger(levels) || levels < 1) {
      throw new RangeError(
        `levels must be an integer >= 1, got ${levels}`,
      );
    }
    // Cap at 32 — even 2**32 leaves (4.3 billion bigints) would require
    // > 100 GB of memory on its own, far past anything practical for a
    // browser wallet.  This is a generous limit; real deployments use
    // depth 20 or 32 at most.
    if (levels > 32) {
      throw new RangeError(
        `levels must be <= 32, got ${levels}`,
      );
    }

    // Validate every leaf is a well-formed field element in [0, FR_MODULUS)
    // before hashing — otherwise Poseidon or the circuit will fail with
    // confusing errors deep in the stack.
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      if (leaf < 0n || leaf >= FR_MODULUS) {
        throw new RangeError(
          `leaf at index ${i} must satisfy 0 <= leaf < FR_MODULUS, got ${leaf}`,
        );
      }
    }

    const capacity = 2 ** levels;
    if (leaves.length > capacity) {
      throw new InvalidInputError(
        `too many leaves (${leaves.length}) for ${levels} levels (capacity ${capacity})`,
      );
    }

    const padded = leaves.slice();
    while (padded.length < capacity) padded.push(ZERO_VALUE);

    const layers: bigint[][] = [padded];
    let current = padded;
    for (let level = 0; level < levels; level++) {
      const next: bigint[] = [];
      for (let i = 0; i < current.length; i += 2) {
        next.push(poseidon(current[i], current[i + 1]));
      }
      layers.push(next);
      current = next;
    }

    return new MerkleTree(levels, leaves, layers);
  }

  /**
   * The root of the Merkle tree.
   */
  get root(): bigint {
    return this.layers[this.levels][0];
  }

  /**
   * Finds the index of a leaf in the tree.
   *
   * @param leaf - The leaf value to search for.
   * @returns The index of the leaf, or -1 if not found.
   */
  indexOf(leaf: bigint): number {
    return this.leaves.findIndex((l) => l === leaf);
  }

  /**
   * Generates a Merkle proof for a leaf at the given index.
   *
   * @param leafIndex - The index of the leaf in the tree.
   * @returns A MerkleProof containing the root, path elements, and path indices.
   * @throws {InvalidInputError} If the leaf index is out of range.
   */
  proof(leafIndex: number): MerkleProof {
    if (leafIndex < 0 || leafIndex >= this.layers[0].length) {
      throw new InvalidInputError("leaf index out of range");
    }

    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let index = leafIndex;

    for (let level = 0; level < this.levels; level++) {
      const layer = this.layers[level];
      const isRightNode = index % 2 === 1;
      const siblingIndex = isRightNode ? index - 1 : index + 1;
      pathElements.push(layer[siblingIndex]);
      pathIndices.push(isRightNode ? 1 : 0);
      index = Math.floor(index / 2);
    }

    return { root: this.root, pathElements, pathIndices };
  }

  /**
   * Generates a Merkle proof for a leaf by its value.
   *
   * Convenience wrapper around {@link indexOf} and {@link proof} that throws a
   * descriptive error if the leaf is not found, instead of returning -1.
   *
   * @param leaf - The leaf value to prove membership for.
   * @returns A MerkleProof for the leaf.
   * @throws {InvalidInputError} If the leaf is not found in the tree.
   */
  proofOf(leaf: bigint): MerkleProof {
    const index = this.indexOf(leaf);
    if (index === -1) {
      const hexShort = "0x" + leaf.toString(16).slice(0, 16) + "…";
      const capacity = this.layers[0].length;
      const occupied = this.leaves.length;
      throw new InvalidInputError(
        `leaf ${hexShort} not found in this tree (${capacity} slots, ${occupied} occupied)`,
      );
    }
    return this.proof(index);
  }
}
