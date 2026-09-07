/**
 * Branded primitive types for the Sharibo SDK.
 *
 * A "brand" is a zero-cost type-level tag that lets the TypeScript compiler
 * distinguish otherwise identical primitive types from each other — preventing
 * accidental mixing at the call site without any runtime overhead.
 *
 * @example
 * ```ts
 * // Without branding, both are `bigint` — easy to swap:
 * function fund(circleId: bigint, round: bigint) { ... }
 *
 * // With branding, the compiler rejects the wrong order:
 * function fund(circleId: CircleId, round: bigint) { ... }
 * fund(round, circleId); // ❌ Type error — CircleId is not assignable to bigint
 * ```
 *
 * @module
 */

/**
 * Attach a unique type-level tag `K` to a base type `T`.
 *
 * The `__brand` property only exists in the type system; at runtime the
 * value is still a plain `T`. The intersection with `{ readonly __brand: K }`
 * is what makes two different branded types incompatible even when they share
 * the same underlying primitive.
 */
export type Brand<T, K extends string> = T & { readonly __brand: K };

/**
 * The unique identifier assigned to a Sharibo circle at creation time.
 *
 * On-chain this is a `u64` counter starting from 0. In the TypeScript SDK it
 * is surfaced as a `bigint`; branding it as `CircleId` prevents it from being
 * inadvertently passed where a plain token amount, nullifier hash, or any
 * other `bigint` is expected.
 *
 * Obtain a `CircleId` via {@link makeCircleId} (after you validate / receive
 * the raw value) or via the return value of {@link createCircle}.
 */
export type CircleId = Brand<bigint, "CircleId">;

/**
 * Cast a raw `bigint` to a {@link CircleId}.
 *
 * This is the single place where an untagged `bigint` becomes a `CircleId`.
 * Use it when you receive a circle ID from an external source (e.g., a
 * URL parameter, a database, or user input) and have already validated that
 * the value is a non-negative integer.
 *
 * @param id - A non-negative `bigint` that represents a circle ID.
 * @returns The same value branded as a `CircleId`.
 * @throws {RangeError} if `id` is negative.
 *
 * @example
 * ```ts
 * const id = makeCircleId(BigInt(urlParams.get("circle") ?? "0"));
 * const circle = await getCircle(client, id);
 * ```
 */
export function makeCircleId(id: bigint): CircleId {
  if (id < 0n) {
    throw new RangeError(`CircleId must be non-negative, got ${id}`);
  }
  return id as CircleId;
}
