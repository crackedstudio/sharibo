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
import type { OnEventFn } from "./events.js";

/**
 * Options for a proving run.
 *
 * @property signal - Cancels artifact download and short-circuits before the
 *   un-interruptible WASM proving phase. snarkjs itself cannot be aborted, so
 *   an abort during proving stops the caller waiting, not the worker.
 * @property onEvent - Observability hook (proof:started / proof:finished).
 */
export interface ProveOptions {
  signal?: AbortSignal;
  onEvent?: OnEventFn;
}
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


/** Everything `generateProof` hands back: the contract-ready proof, the raw
 * snarkjs proof, and the public signals derived alongside it. */
export interface GenerateProofResult {
  proof: ContractProof;
  snarkjsProof: unknown;
  publicSignals: string[];
  nullifierHash: bigint;
  root: bigint;
  externalNullifier: bigint;
  provingTimeMs: number;
}

export interface ProofResult {
  proof: unknown;
  publicSignals: string[];
  provingTimeMs: number;
  artifactDownloadTimeMs: number;
  totalTimeMs: number;
}

let artifactPromise: Promise<ProverArtifacts> | undefined;

export function getArtifacts(signal?: AbortSignal): Promise<ProverArtifacts> {
  // If a signal is provided, use a dedicated cancellable fetch so an abort
  // does not poison the shared background cache.
  if (signal) {
    return prefetchMembershipArtifacts(signal);
  }
  if (!artifactPromise) {
    artifactPromise = import("./artifacts").then(({ prefetchMembershipArtifacts }) =>
      prefetchMembershipArtifacts()
    );
  }
  return artifactPromise;
}

function decimalStringToUint8Array(decimal: string, length: number): Uint8Array {
  const value = BigInt(decimal);
  const bytes = new Uint8Array(length);
  let remaining = value;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(remaining & 0xffn);
    remaining = remaining >> 8n;
  }
  return bytes;
}

function packG1(coords: [string, string, string]): Uint8Array {
  const x = decimalStringToUint8Array(coords[0], 48);
  const y = decimalStringToUint8Array(coords[1], 48);
  const packed = new Uint8Array(96);
  packed.set(x, 0);
  packed.set(y, 48);
  return packed;
}

function packG2(coords: [string, string, string, string]): Uint8Array {
  const x1 = decimalStringToUint8Array(coords[0], 48);
  const x0 = decimalStringToUint8Array(coords[1], 48);
  const y1 = decimalStringToUint8Array(coords[2], 48);
  const y0 = decimalStringToUint8Array(coords[3], 48);
  const packed = new Uint8Array(192);
  packed.set(x1, 0);
  packed.set(x0, 48);
  packed.set(y1, 96);
  packed.set(y0, 144);
  return packed;
}

export function verificationKeyToContractFormat(vkJson: unknown): ContractVerificationKey {
  if (typeof vkJson !== "object" || vkJson === null) {
    throw new Error("verification key must be an object");
  }

  const vk = vkJson as Record<string, unknown>;

  if (typeof vk.nPublic !== "number") {
    throw new Error("verification key missing nPublic");
  }

  const ic = vk.IC;
  if (!Array.isArray(ic)) {
    throw new Error("verification key missing IC array");
  }

  if (ic.length !== vk.nPublic + 1) {
    throw new Error(
      `verification key IC length ${ic.length} does not match nPublic + 1 (${vk.nPublic + 1})`,
    );
  }

  const alpha1 = vk.vk_alpha_1;
  if (!Array.isArray(alpha1) || alpha1.length < 2) {
    throw new Error("verification key missing vk_alpha_1 coordinates");
  }
  const alpha = packG1([alpha1[0] as string, alpha1[1] as string, alpha1[2] as string]);

  const beta2 = vk.vk_beta_2;
  if (!Array.isArray(beta2) || beta2.length < 2) {
    throw new Error("verification key missing vk_beta_2 coordinates");
  }
  const beta = packG2([beta2[0][0] as string, beta2[0][1] as string, beta2[1][0] as string, beta2[1][1] as string]);

  const gamma2 = vk.vk_gamma_2;
  if (!Array.isArray(gamma2) || gamma2.length < 2) {
    throw new Error("verification key missing vk_gamma_2 coordinates");
  }
  const gamma = packG2([gamma2[0][0] as string, gamma2[0][1] as string, gamma2[1][0] as string, gamma2[1][1] as string]);

  const delta2 = vk.vk_delta_2;
  if (!Array.isArray(delta2) || delta2.length < 2) {
    throw new Error("verification key missing vk_delta_2 coordinates");
  }
  const delta = packG2([delta2[0][0] as string, delta2[0][1] as string, delta2[1][0] as string, delta2[1][1] as string]);

  const icPoints: Uint8Array[] = [];
  for (const point of ic) {
    if (!Array.isArray(point) || point.length < 2) {
      throw new Error("verification key IC entry missing coordinates");
    }
    icPoints.push(packG1([point[0] as string, point[1] as string, point[2] as string]));
  }

  return { alpha, beta, gamma, delta, ic: icPoints };
}

// Internal helper: races a snarkjs prove call against an optional abort signal.
// snarkjs does not accept an AbortSignal, so we use Promise.race — the WASM
// worker keeps running in the background but the caller stops waiting.
async function raceProve(
  input: Record<string, unknown>,
  wasm: string | Uint8Array,
  zkey: string | Uint8Array,
  signal: AbortSignal | undefined,
): Promise<{ proof: unknown; publicSignals: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provePromise = (groth16 as any).fullProve(input, wasm, zkey);

  if (!signal) return provePromise;

  const abortPromise = new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("Aborted", "AbortError")),
      { once: true },
    );
  });

  return Promise.race([provePromise, abortPromise]);
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
  options?: ProveOptions,
): Promise<GenerateProofResult> {
  const { signal, onEvent } = options ?? {};
  signal?.throwIfAborted();
  onEvent?.({ type: "proof:started" });
  // Reject out-of-range / malformed circuit inputs BEFORE the un-interruptible
  // WASM proving phase. The circuit itself has no range check on
  // pathElements — the wasm witness generator wraps non-canonical values mod
  // FR_MODULUS on assignment (issue #269) — so this is the defense that keeps
  // a non-canonical encoding from ever reaching the prover.
  validateCircuitInput(input);
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

  onEvent?.({ type: "proof:finished" });

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

// ── fullProve (internal / artifact-caching path) ─────────────────────────────

/**
 * Generates a membership proof using the already-downloaded binary circuit
 * artifacts. The proving timer intentionally starts after this await so that
 * network time is not reported as proving/compute time.
 */
export async function fullProve(
  input: Record<string, unknown>,
  options?: ProveOptions,
): Promise<ProofResult> {
  const { signal } = options ?? {};

  const artifacts = await getArtifacts(signal);

  // Check before entering the un-interruptible WASM phase.
  signal?.throwIfAborted();

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
  options?: ProveOptions,
): Promise<ProofResult> {
  return fullProve(input, options);
}

// ── Encoding helpers (public: exercised by prove.test.ts) ────────────────────

/** Bytes per BLS12-381 base-field element in the contract wire format. */
export const FP_BYTES = 48;

/** Big-endian 48-byte encoding of a base-field element given as a decimal string. */
export function feToBytes(decimal: string): Uint8Array {
  return decimalStringToUint8Array(decimal, FP_BYTES);
}

/** Uncompressed G1 point: X||Y, 96 bytes. */
export function g1ToBytes(point: string[]): Uint8Array {
  return encodeG1(point);
}

/** Uncompressed G2 point: Xc1||Xc0||Yc1||Yc0, 192 bytes. */
export function g2ToBytes(point: string[][]): Uint8Array {
  return encodeG2(point);
}
