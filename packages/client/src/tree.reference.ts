/**
 * Naive reference implementation of the Merkle tree.
 *
 * PURPOSE — differential testing only.
 *
 * This file is intentionally NOT exported from index.ts. Import it only
 * from test files. It is the "obviously correct" oracle: for every query
 * it rebuilds the full layer array from scratch (no caching, no cleverness)
 * so that the correctness of each result is apparent from a single read
 * of the code without understanding any optimisation.
 *
 * It uses the same {@link poseidon} function and {@link ZERO_VALUE} constant
 * as the production tree so that the only thing the differential test
 * exercises is the indexing / sibling-selection / path-direction logic —
 * the part that is easy to get subtly wrong and hard to catch with unit
 * tests alone.
 *
 * Convention (must match the circuit's MerkleTreeChecker exactly):
 *   pathIndices[i] = 0  → current node is the LEFT child at level i
 *   pathIndices[i] = 1  → current node is the RIGHT child at level i
 *
 * In both cases the sibling is pathElements[i], and the parent is
 *   Poseidon(left, right)
 * where (left, right) = (currentNode, sibling) when index == 0
 *   and (left, right) = (sibling, currentNode) when index == 1.
 */

import { poseidon } from "./identity.js";
import { ZERO_VALUE } from "./tree.js";
import type { MerkleProof } from "./tree.js";

/**
 * Builds every layer of the tree from scratch and returns them.
 *
 * Layer 0 = leaves (padded to 2^levels with ZERO_VALUE).
 * Layer k = parent hashes of layer k-1.
 * Layer levels = single root element.
 *
 * @internal
 */
function buildLayers(levels: number, leaves: readonly bigint[]): bigint[][] {
  const capacity = 2 ** levels;
  // Pad leaves to full capacity with ZERO_VALUE — same rule as production.
  const layer0: bigint[] = Array.from({ length: capacity }, (_, i) =>
    i < leaves.length ? leaves[i] : ZERO_VALUE,
  );

  const layers: bigint[][] = [layer0];
  let current = layer0;

  for (let level = 0; level < levels; level++) {
    const next: bigint[] = [];
    // Hash pairs left-to-right, exactly as the production tree does.
    for (let i = 0; i < current.length; i += 2) {
      next.push(poseidon(current[i], current[i + 1]));
    }
    layers.push(next);
    current = next;
  }

  return layers;
}

/**
 * Computes the Merkle root for the given leaves at the given depth.
 *
 * Rebuilds the full tree on every call — O(2^levels) hashes.
 */
export function referenceRoot(levels: number, leaves: readonly bigint[]): bigint {
  const layers = buildLayers(levels, leaves);
  return layers[levels][0];
}

/**
 * Generates a Merkle proof for the leaf at {@link leafIndex}.
 *
 * Rebuilds the full tree from scratch on every call. No caching.
 *
 * @param levels    - Tree depth (capacity = 2^levels).
 * @param leaves    - The actual (un-padded) leaf values.
 * @param leafIndex - Index of the leaf to prove (0-based, within capacity).
 * @returns A {@link MerkleProof} whose root, pathElements, and pathIndices
 *          can be fed directly into the circuit as-is.
 */
export function referenceProof(
  levels: number,
  leaves: readonly bigint[],
  leafIndex: number,
): MerkleProof {
  const layers = buildLayers(levels, leaves);
  const root = layers[levels][0];

  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];

  let index = leafIndex;

  for (let level = 0; level < levels; level++) {
    const layer = layers[level];
    // isRightNode: true when the current node is the RIGHT child of its parent.
    // Equivalently: its index is odd.
    const isRightNode = index % 2 === 1;
    const siblingIndex = isRightNode ? index - 1 : index + 1;

    pathElements.push(layer[siblingIndex]);
    // 0 = current node is left child; 1 = current node is right child.
    pathIndices.push(isRightNode ? 1 : 0);

    // Move up one level: parent index = floor(child index / 2).
    index = Math.floor(index / 2);
  }

  return { root, pathElements, pathIndices };
}

/**
 * Verifies a {@link MerkleProof} by recomputing the root from the leaf and
 * the path, then comparing against {@link proof.root}.
 *
 * This is the "obviously correct" verifier — no optimisation, no state.
 * Its correctness follows directly from the circuit's MerkleTreeChecker
 * template (see circuits/membership.template.circom).
 *
 * @returns `true` if the proof is internally consistent; `false` otherwise.
 */
export function referenceVerify(leaf: bigint, proof: MerkleProof): boolean {
  let current = leaf;

  for (let i = 0; i < proof.pathElements.length; i++) {
    const sibling = proof.pathElements[i];
    const isRight = proof.pathIndices[i] === 1;

    // Reconstruct (left, right) exactly as MerkleTreeChecker does:
    //   isRight == false → current node is left child  → hash(current, sibling)
    //   isRight == true  → current node is right child → hash(sibling, current)
    const left = isRight ? sibling : current;
    const right = isRight ? current : sibling;
    current = poseidon(left, right);
  }

  return current === proof.root;
}
