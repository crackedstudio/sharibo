import { poseidon2 } from "poseidon-bls12381";
import { InvalidInputError } from "./errors.js";

// Web Crypto (`globalThis.crypto`) rather than `node:crypto`, so this module
// runs unmodified in both Node (18+) and the browser app (Phase 5) — no
// bundler polyfill needed.
const webCrypto: Crypto = globalThis.crypto;

/**
 * A user's cryptographic identity for participation in Sharibo circles.
 *
 * @property identityNullifier - The nullifier component of the identity.
 * @property identitySecret - The secret component of the identity.
 * @property commitment - The Poseidon hash of identityNullifier and identitySecret.
 */
export interface Identity {
  identityNullifier: bigint;
  identitySecret: bigint;
  commitment: bigint;
}

// BLS12-381 scalar field modulus r (matches Soroban's own Fr and the
// poseidon-bls12381 package — cross-checked against soroban-sdk's
// BLS12_381_FR_MODULUS_BE constant).
export const FR_MODULUS = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

function bytesToBigInt(bytes: Uint8Array): bigint {
  return BigInt("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
}

/**
 * Generates a random field element using wide reduction.
 *
 * Samples uniformly from the full BLS12-381 scalar field by taking 64 random
 * bytes (512 bits) and reducing modulo FR_MODULUS (~2^255). This has a
 * cryptographically negligible bias (< 2^-250) which is vastly smaller than the
 * ~2^-128 security level Poseidon targets.
 *
 * @returns A random field element in [0, FR_MODULUS).
 *
 * @remarks
 * Wide reduction: 64 random bytes (512 bits) mod FR_MODULUS (~2^255).
 *
 * This samples uniformly from the full field, at the cost of a small,
 * cryptographically negligible bias (< 2^-250, since 2^512 is not an exact
 * multiple of FR_MODULUS) — vastly smaller than the ~2^-128 security level
 * Poseidon and the field itself target. The previous approach (31 random
 * bytes / 248 bits, always < FR_MODULUS, no reduction needed) had ample
 * entropy on its own but only ever produced values in a 2^248 subset of the
 * ~2^255 field (top ~7 bits always zero); Poseidon's preimage security here
 * doesn't depend on full-field uniformity, but wide reduction removes the
 * deviation entirely for the cost of one extra `getRandomValues` call and a
 * `%`, so we do it rather than leave the narrower scheme as a documented
 * judgment call. See Issue #66.
 */
export function randomFieldElement(): bigint {
  const bytes = webCrypto.getRandomValues(new Uint8Array(64));
  return bytesToBigInt(bytes) % FR_MODULUS;
}

/**
 * Computes the Poseidon hash of two field elements.
 *
 * @param a - First field element.
 * @param b - Second field element.
 * @returns The Poseidon hash of the two inputs.
 */
export function poseidon(a: bigint, b: bigint): bigint {
  return poseidon2([a, b]);
}

/**
 * Generates a new cryptographic identity.
 *
 * Creates a random identityNullifier and identitySecret, then computes the
 * commitment as their Poseidon hash.
 *
 * @returns A new Identity with random nullifier, secret, and commitment.
 */
export function generateIdentity(): Identity {
  const identityNullifier = randomFieldElement();
  const identitySecret = randomFieldElement();
  const commitment = poseidon(identityNullifier, identitySecret);
  return { identityNullifier, identitySecret, commitment };
}

// DELIBERATE, PERMANENT DEVIATION from "Poseidon everywhere": external
// nullifier binding (circle_id, round) happens with SHA-256, matching the
// contract (see contracts/sharibo/src/lib.rs, compute_external_nullifier).
// Poseidon is used only where it saves constraints *inside* the circuit
// (commitment + nullifierHash); Soroban has no native Poseidon host
// function, so nothing is gained by porting Poseidon into the contract for
// this check, and SHA-256 is equally sound for binding a proof to a round.
// See NOTES.md.
export async function computeExternalNullifier(circleId: bigint, round: bigint): Promise<bigint> {
  // Bounds must match the contract's field types exactly (see
  // contracts/sharibo/src/lib.rs: `circle_id: u64`, `round: u32`).
  // `setBigUint64`/`setUint32` below would otherwise silently truncate (or,
  // for `Number(round)` on a bigint > 2^53, silently lose precision first),
  // producing a valid-looking but wrong hash that the contract rejects with
  // an opaque `WrongRoundTag` — Issue #65.
  if (circleId < 0n || circleId >= 2n ** 64n) {
    throw new InvalidInputError(
      `circleId must satisfy 0 <= circleId < 2**64 (u64), got ${circleId}`,
    );
  }
  if (round < 0n || round >= 2n ** 32n) {
    throw new InvalidInputError(
      `round must satisfy 0 <= round < 2**32 (u32), got ${round}`,
    );
  }

  const buf = new ArrayBuffer(12);
  const view = new DataView(buf);
  view.setBigUint64(0, circleId, false);
  view.setUint32(8, Number(round), false);
  const digest = await webCrypto.subtle.digest("SHA-256", buf);
  return bytesToBigInt(new Uint8Array(digest)) % FR_MODULUS;
}

export function computeNullifierHash(identityNullifier: bigint, externalNullifier: bigint): bigint {
  return poseidon(identityNullifier, externalNullifier);
}
