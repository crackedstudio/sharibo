/**
 * Manual mock for @sharibo/client.
 *
 * The real package imports poseidon-bls12381 (WASM) and snarkjs (heavy
 * crypto) at module load time. Those are incompatible with a jsdom test
 * environment and require circuit artefact files that aren't present in CI.
 *
 * Tests that import this mock via `vi.mock('@sharibo/client')` get lightweight
 * stub implementations instead, so the UI layer can be tested in isolation
 * without any crypto or Stellar RPC calls.
 *
 * HOW TO USE IN TESTS:
 *
 *   vi.mock('@sharibo/client');
 *
 * Vitest will auto-resolve this file for any test that calls
 * `vi.mock('@sharibo/client')` because it lives at
 * <root>/__mocks__/@sharibo/client.ts, adjacent to the root node_modules
 * where the workspace symlink for @sharibo/client lives.
 */

import { vi } from "vitest";
import type {
  Identity,
  ContractProof,
  ContractVerificationKey,
  SharaboNetworkConfig,
  SharaboClient,
  TxResult,
  CircleView,
  MerkleProof,
} from "@sharibo/client";

// ── Identity ──────────────────────────────────────────────────────────────────

export const FR_MODULUS =
  0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

export const randomFieldElement = vi.fn((): bigint => 42n);

export const poseidon = vi.fn((a: bigint, b: bigint): bigint => a ^ b);

export const generateIdentity = vi.fn((): Identity => ({
  identityNullifier: 1n,
  identitySecret: 2n,
  commitment: 3n,
}));

export const computeExternalNullifier = vi.fn(
  async (_circleId: bigint, _round: bigint): Promise<bigint> => 99n,
);

export const computeNullifierHash = vi.fn(
  (_identityNullifier: bigint, _externalNullifier: bigint): bigint => 77n,
);

// ── Merkle tree ───────────────────────────────────────────────────────────────

export const ZERO_VALUE = 0n;

export interface MerkleProofMock extends MerkleProof {}

/** Stub MerkleTree with fixed root and trivial proofs. */
export class MerkleTree {
  readonly levels: number;
  readonly root: bigint = 12345n;

  constructor(levels: number) {
    this.levels = levels;
  }

  static create(_levels: number, _leaves: bigint[]): MerkleTree {
    return new MerkleTree(_levels);
  }

  indexOf(_leaf: bigint): number {
    return 0;
  }

  proof(_leafIndex: number): MerkleProof {
    return {
      root: this.root,
      pathElements: Array(this.levels).fill(0n) as bigint[],
      pathIndices: Array(this.levels).fill(0) as number[],
    };
  }
}

// ── Proof / verify ────────────────────────────────────────────────────────────

export const verificationKeyToContractFormat = vi.fn(
  (_vk: unknown): ContractVerificationKey => ({
    alpha: new Uint8Array(96),
    beta: new Uint8Array(192),
    gamma: new Uint8Array(192),
    delta: new Uint8Array(192),
    ic: [new Uint8Array(96), new Uint8Array(96), new Uint8Array(96), new Uint8Array(96)],
  }),
);

export const generateProof = vi.fn(async () => ({
  proof: {
    a: new Uint8Array(96),
    b: new Uint8Array(192),
    c: new Uint8Array(96),
  } as ContractProof,
  snarkjsProof: { pi_a: ["0", "0", "1"], pi_b: [["0","0"],["0","0"],["1","0"]], pi_c: ["0","0","1"] },
  publicSignals: ["77", "12345", "99"],
  nullifierHash: 77n,
  root: 12345n,
  externalNullifier: 99n,
  provingTimeMs: 0,
}));

export const verifyProofLocally = vi.fn(async (): Promise<number> => 1);

export const estimateClaimFee = vi.fn(
  async (): Promise<import("@sharibo/client").FeeEstimate | null> => ({
    minResourceFee: 500_000n,
    totalFee: 600_000n,
  }),
);

// ── Contract ──────────────────────────────────────────────────────────────────

export const connect = vi.fn(
  async (
    _config: SharaboNetworkConfig,
    _keypair: unknown,
  ): Promise<SharaboClient> => ({}) as SharaboClient,
);

export const createCircle = vi.fn(
  async (_client: SharaboClient, _args: unknown): Promise<TxResult<bigint>> => ({
    result: 0n,
    hash: "mockCreateHash",
  }),
);

export const fund = vi.fn(
  async (_client: SharaboClient, _args: unknown): Promise<TxResult<void>> => ({
    result: undefined,
    hash: "mockFundHash",
  }),
);

export const claim = vi.fn(
  async (_client: SharaboClient, _args: unknown): Promise<TxResult<void>> => ({
    result: undefined,
    hash: "mockClaimHash",
  }),
);

export const getCircle = vi.fn(
  async (_client: SharaboClient, _circleId: bigint): Promise<CircleView> => ({
    admin: "MOCK_ADMIN",
    token: "MOCK_TOKEN",
    root: 12345n,
    contribution: 100_000_000n,
    size: 5,
    round: 0,
    pot: 0n,
  }),
);
