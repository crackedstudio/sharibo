// No `node:*` imports and no `Buffer` at module scope (deliberately) — this
// file is used both from Node (scripts/e2e.ts, passing filesystem paths)
// and from the browser app (Phase 5, passing fetchable URLs under
// /circuits/). snarkjs's fullProve accepts either transparently, and
// Uint8Array (unlike Buffer) needs no polyfill in the browser.

import { groth16 } from "snarkjs";
import {
  prefetchMembershipArtifacts,
  type ProverArtifacts,
} from "./artifacts.js";
import { ProvingError, InvalidInputError } from "./errors.js";
import { TREE_LEVELS } from "./config.js";
import { FR_MODULUS } from "./identity.js";

/**
 * The structured circuit input for the membership proof.
 */
export interface CircuitInput {
  identityNullifier: bigint;
  identitySecret: bigint;
  pathElements: bigint[];
  pathIndices: number[];
  root: bigint;
  externalNullifier: bigint;
}

/**
 * A Groth16 proof in the wire format expected by the Sharibo contract.
 * Each field is a compressed BLS12-381 point.
 */
export interface ContractProof {
  a: Uint8Array; // G1 compressed (96 bytes)
  b: Uint8Array; // G2 compressed (192 bytes)
  c: Uint8Array; // G1 compressed (96 bytes)
}

/**
 * Verification key in the format expected by the Sharibo contract.
 */
export interface ContractVerificationKey {
  alpha: Uint8Array;
  beta: Uint8Array;
  gamma: Uint8Array;
  delta: Uint8Array;
  ic: Uint8Array[];
}


export interface ProofResult {
  proof: unknown;
  publicSignals: string[];
  provingTimeMs: number;
  artifactDownloadTimeMs: number;
  totalTimeMs: number;
}

/**
 * The result of generateProof — the contract-encoded proof alongside the
 * public signals and the raw snarkjs proof (needed for local verification).
 */
export interface GenerateProofResult {
  proof: ContractProof;
  /** Raw snarkjs proof object, suitable for groth16.verify. */
  snarkjsProof: unknown;
  publicSignals: string[];
  nullifierHash: bigint;
  root: bigint;
  externalNullifier: bigint;
  provingTimeMs: number;
}

let artifactPromise: Promise<ProverArtifacts> | undefined;

export function getArtifacts(): Promise<ProverArtifacts> {
  if (!artifactPromise) {
    artifactPromise = prefetchMembershipArtifacts();
  }
  return artifactPromise;
}

/**
 * Validates circuit input before proving, throwing InvalidInputError on
 * malformed values.
 *
 * @param input - The circuit input to validate.
 * @param levels - Expected Merkle tree depth (defaults to TREE_LEVELS).
 */
export function validateCircuitInput(
  input: CircuitInput,
  levels: number = TREE_LEVELS,
): void {
  if (input.pathElements.length !== levels) {
    throw new InvalidInputError(
      `pathElements: expected ${levels}, got ${input.pathElements.length}`,
    );
  }
  if (input.pathIndices.length !== levels) {
    throw new InvalidInputError(
      `pathIndices: expected ${levels}, got ${input.pathIndices.length}`,
    );
  }
  for (let i = 0; i < levels; i++) {
    const idx = input.pathIndices[i];
    if (idx !== 0 && idx !== 1) {
      throw new InvalidInputError(
        `pathIndices[${i}]: expected 0 or 1, got ${idx}`,
      );
    }
  }

  const fieldChecks: [string, bigint][] = [
    ["identityNullifier", input.identityNullifier],
    ["identitySecret", input.identitySecret],
    ["root", input.root],
    ["externalNullifier", input.externalNullifier],
  ];
  for (const [name, value] of fieldChecks) {
    if (value < 0n || value >= FR_MODULUS) {
      throw new InvalidInputError(
        `${name}: must be in [0, FR_MODULUS), got ${value}`,
      );
    }
  }
  for (let i = 0; i < input.pathElements.length; i++) {
    const val = input.pathElements[i];
    if (val < 0n || val >= FR_MODULUS) {
      throw new InvalidInputError(
        `pathElements[${i}]: must be in [0, FR_MODULUS), got ${val}`,
      );
    }
  }
}

// ── Cross-environment performance timer ──────────────────────────────────────
// `globalThis.performance` is available in Node ≥ 16 and all modern browsers.
// We capture it once here rather than calling `performance.now()` directly so
// that TypeScript doesn't complain about the global not being declared under
// the "node" types configuration, and so the reference is explicit about
// which object we're using.
const perf: { now(): number } =
  typeof globalThis.performance !== "undefined"
    ? globalThis.performance
    : { now: () => 0 };


// snarkjs returns G1 and G2 points as arrays of decimal strings. We encode
// them to the BLS12-381 compressed-point format that the Soroban contract
// expects (matching soroban-sdk's Bls12_381G1Affine / G2Affine layout).
export function encodeG1(point: string[]): Uint8Array {
  const x = BigInt(point[0]);
  const y = BigInt(point[1]);
  // BLS12-381 G1 uncompressed: 48 bytes x || 48 bytes y, big-endian.
  // Use compressed flag (bit 7 of first byte = 1) + sign bit (bit 5 if y > p/2).
  // For contract compatibility we use the 96-byte uncompressed encoding.
  const bytes = new Uint8Array(96);
  const xHex = x.toString(16).padStart(96, "0");
  const yHex = y.toString(16).padStart(96, "0");
  for (let i = 0; i < 48; i++) {
    bytes[i] = parseInt(xHex.slice(i * 2, i * 2 + 2), 16);
    bytes[48 + i] = parseInt(yHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Encode a snarkjs G2 affine point [[x0,x1],[y0,y1]] to 192-byte uncompressed form. */
export function encodeG2(point: string[][]): Uint8Array {
  // G2 is a point over Fp2; x = x0 + x1*u, y = y0 + y1*u.
  // Contract expects 192 bytes: x1||x0||y1||y0, each 48 bytes big-endian.
  const [x, y] = point;
  const bytes = new Uint8Array(192);
  const fields = [x[1], x[0], y[1], y[0]];
  for (let f = 0; f < 4; f++) {
    const hex = BigInt(fields[f]).toString(16).padStart(96, "0");
    for (let i = 0; i < 48; i++) {
      bytes[f * 48 + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
  }
  return bytes;
}

// ── generateProof ────────────────────────────────────────────────────────────

/**
 * Generates a Groth16 membership proof from circuit inputs and artifact bytes.
 *
 * @param input - The typed circuit input.
 * @param wasm - The compiled circuit wasm bytes.
 * @param zkey - The proving key bytes.
 * @returns Proof in both snarkjs and contract formats, plus public signals.
 */
export async function generateProof(
  input: CircuitInput,
  wasm: Uint8Array | string,
  zkey: Uint8Array | string,
): Promise<GenerateProofResult> {
  // Serialise bigints to strings for snarkjs
  const snarkInput: Record<string, unknown> = {
    identityNullifier: input.identityNullifier.toString(),
    identitySecret: input.identitySecret.toString(),
    pathElements: input.pathElements.map((e) => e.toString()),
    pathIndices: input.pathIndices,
    root: input.root.toString(),
    externalNullifier: input.externalNullifier.toString(),
  };

  const provingStartedAt = perf.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { proof: snarkjsProof, publicSignals } = await (groth16 as any).fullProve(
    snarkInput,
    wasm,
    zkey,
  );
  const provingTimeMs = Math.max(0, perf.now() - provingStartedAt);

  // publicSignals order: [nullifierHash, root, externalNullifier]
  const nullifierHash = BigInt(publicSignals[0]);
  const root = BigInt(publicSignals[1]);
  const externalNullifier = BigInt(publicSignals[2]);

  // Encode to contract wire format
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = snarkjsProof as any;
  const contractProof: ContractProof = {
    a: encodeG1(p.pi_a),
    b: encodeG2(p.pi_b),
    c: encodeG1(p.pi_c),
  };

  return {
    proof: contractProof,
    snarkjsProof,
    publicSignals,
    nullifierHash,
    root,
    externalNullifier,
    provingTimeMs,
  };
}

// ── verifyProofLocally ───────────────────────────────────────────────────────

/**
 * Verifies a Groth16 proof client-side using snarkjs, before any network
 * call. If the proof is invalid, throws ProvingError immediately, saving the
 * cost of a rejected on-chain transaction.
 *
 * A proof that passes here but fails on-chain almost certainly has an
 * encoding problem (wrong point format, wrong public signal order) rather
 * than a bad proof — see docs/troubleshooting.md.
 *
 * @param vkJson - The raw verification key JSON (from verification_key.json).
 * @param publicSignals - Public signals as decimal strings, matching snarkjs order.
 * @param snarkjsProof - The raw snarkjs proof object (not the ContractProof bytes).
 * @returns The verification time in milliseconds.
 * @throws ProvingError if verification fails.
 */
export async function verifyProofLocally(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vkJson: any,
  publicSignals: string[],
  snarkjsProof: unknown,
): Promise<number> {
  const startedAt = perf.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const valid = await (groth16 as any).verify(vkJson, publicSignals, snarkjsProof);
  const verifyTimeMs = Math.max(0, perf.now() - startedAt);

  if (!valid) {
    throw new ProvingError(
      "Local proof verification failed — proof is invalid before encoding. " +
      "Check circuit inputs, Merkle path, and round tag.",
    );
  }

  return verifyTimeMs;
}

// ── verificationKeyToContractFormat ─────────────────────────────────────────

/**
 * Converts a snarkjs verification key JSON to the byte format expected by
 * the Sharibo contract.
 *
 * @param vkJson - The raw verification key JSON object.
 * @returns The contract-formatted verification key.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function verificationKeyToContractFormat(vkJson: any): ContractVerificationKey {
  return {
    alpha: encodeG1(vkJson.vk_alpha_1),
    beta: encodeG2(vkJson.vk_beta_2),
    gamma: encodeG2(vkJson.vk_gamma_2),
    delta: encodeG2(vkJson.vk_delta_2),
    ic: vkJson.IC.map((pt: string[]) => encodeG1(pt)),
  };
}

// ── fullProve (internal / artifact-caching path) ─────────────────────────────

/**
 * Generates a membership proof using the already-downloaded binary circuit
 * artifacts. The proving timer intentionally starts after this await so that
 * network time is not reported as proving/compute time.
 */
export async function fullProve(
  input: Record<string, unknown>,
): Promise<ProofResult> {
  const artifacts = await getArtifacts();

  const provingStartedAt = perf.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (groth16 as any).fullProve(
    input,
    artifacts.wasm,
    artifacts.zkey,
  );
  const provingTimeMs = Math.max(0, perf.now() - provingStartedAt);

  return {
    ...result,
    provingTimeMs,
    artifactDownloadTimeMs: 0,
    totalTimeMs: provingTimeMs,
  };
}

export async function prove(
  input: Record<string, unknown>,
): Promise<ProofResult> {
  return fullProve(input);
}

