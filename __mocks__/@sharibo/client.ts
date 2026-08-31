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
  ShariboNetworkConfig,
  ShariboClient,
  TxResult,
  CircleView,
  MerkleProof,
} from "@sharibo/client";

export const TREE_LEVELS = 4;
export const MAX_CIRCLE_SIZE = 2 ** TREE_LEVELS;

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
  nullifierHash: 77n,
  root: 12345n,
  externalNullifier: 99n,
}));

// ── Contract ──────────────────────────────────────────────────────────────────

export const connect = vi.fn(
  async (
    _config: ShariboNetworkConfig,
    _keypair: unknown,
  ): Promise<ShariboClient> => ({}) as ShariboClient,
);

export const createCircle = vi.fn(
  async (_client: ShariboClient, _args: unknown): Promise<TxResult<bigint>> => ({
    result: 37n,
    hash: "mockCreateHash",
  }),
);

export const fund = vi.fn(
  async (_client: ShariboClient, _args: unknown): Promise<TxResult<void>> => ({
    result: undefined,
    hash: "mockFundHash",
  }),
);

export const claim = vi.fn(
  async (_client: ShariboClient, _args: unknown): Promise<TxResult<void>> => ({
    result: undefined,
    hash: "mockClaimHash",
  }),
);

export const getCircle = vi.fn(
  async (_client: ShariboClient, _circleId: bigint): Promise<CircleView> => ({
    admin: "MOCK_ADMIN",
    token: "MOCK_TOKEN",
    root: 12345n,
    contribution: 100_000_000n,
    size: 5,
    round: 0,
    pot: 0n,
  }),
);

export const getCircleCount = vi.fn(async (): Promise<bigint> => 1n);

export const hasClaimed = vi.fn(
  async (_client: ShariboClient, _circleId: bigint, _nullifierHash: bigint): Promise<boolean> =>
    false,
);

// ── SDK facade ────────────────────────────────────────────────────────────────
//
// Mirrors the real `ShariboSDK.connect(...)` interface. In tests the bound
// client is discarded; each method simply delegates to the stub free
// functions above so existing assertions on `connect`/`createCircle`/... keep
// working and interaction flows can be asserted through the facade too.

export class ShariboSDK {
  readonly networkConfig: ShariboNetworkConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly signer: any;
  readonly publicKey: string;
  readonly client: ShariboClient;

  private constructor(
    networkConfig: ShariboNetworkConfig,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    signer: any,
    publicKey: string,
  ) {
    this.networkConfig = networkConfig;
    this.signer = signer;
    this.publicKey = publicKey;
    this.client = ({} as ShariboClient);
  }

  static async connect(
    config: ShariboNetworkConfig,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    keypairOrSigner: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _options?: any,
  ): Promise<ShariboSDK> {
    const publicKey =
      typeof keypairOrSigner?.publicKey === "function"
        ? keypairOrSigner.publicKey()
        : keypairOrSigner?.publicKey ?? "MOCK_PUBLIC_KEY";
    return new ShariboSDK(config, keypairOrSigner, publicKey);
  }

  createCircle(args: unknown): Promise<TxResult<bigint>> {
    return createCircle(this.client, args);
  }

  fund(args: unknown): Promise<TxResult<void>> {
    return fund(this.client, args);
  }

  claim(args: unknown): Promise<TxResult<void>> {
    return claim(this.client, args);
  }

  getCircle(circleId: bigint): Promise<CircleView> {
    return getCircle(this.client, circleId);
  }

  getCircleCount(): Promise<bigint> {
    return getCircleCount(this.client);
  }

  getStatus(): Promise<bigint> {
    return this.getCircleCount();
  }

  hasClaimed(circleId: bigint, nullifierHash: bigint): Promise<boolean> {
    return hasClaimed(this.client, circleId, nullifierHash);
  }
}