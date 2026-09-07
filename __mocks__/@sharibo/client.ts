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

const STROOPS_PER_XLM = 10_000_000n;

export function xlmToStroops(xlm: number | bigint | string): bigint {
  if (typeof xlm === "bigint") return xlm * STROOPS_PER_XLM;
  const value = typeof xlm === "number" ? xlm.toString() : xlm.trim();
  const negative = value.startsWith("-");
  const [wholePart, fractionalPart = ""] = value.replace(/^[+-]/, "").split(".");
  const whole = BigInt(wholePart || "0");
  const fraction = fractionalPart.padEnd(7, "0").slice(0, 7);
  let result = whole * STROOPS_PER_XLM + BigInt(fraction || "0");
  if (fractionalPart.length > 7 && fractionalPart[7] >= "5") result += 1n;
  return negative ? -result : result;
}

export function stroopsToXlm(stroops: bigint): bigint {
  return stroops / STROOPS_PER_XLM;
}

export function formatXlm(stroops: bigint): string {
  const negative = stroops < 0n;
  const absolute = negative ? -stroops : stroops;
  const whole = absolute / STROOPS_PER_XLM;
  const fraction = (absolute % STROOPS_PER_XLM).toString().padStart(7, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

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
    vk: {
      alpha: new Uint8Array(96),
      beta: new Uint8Array(192),
      gamma: new Uint8Array(192),
      delta: new Uint8Array(192),
      ic: [],
    },
    contributors: [],
    cancelled: false,
    fee_bps: 0,
    fee_recipient: "MOCK_FEE_RECIPIENT",
  }),
);

export const cancelCircle = vi.fn(
  async (_client: ShariboClient, _args: unknown): Promise<TxResult<void>> => ({
    result: undefined,
    hash: "mockCancelHash",
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
    return getCircleCount();
  }

  getStatus(): Promise<bigint> {
    return this.getCircleCount();
  }

  hasClaimed(circleId: bigint, nullifierHash: bigint): Promise<boolean> {
    return hasClaimed(this.client, circleId, nullifierHash);
  }
}


// ── Re-exports the UI layer needs (kept in sync with App.tsx's imports) ──────

export {
  ContractError,
  CircleNotFoundError,
  RoundNotFundedError,
  WrongRoundTagError,
  AlreadyClaimedError,
  InvalidProofError,
  RoundFullError,
  OverflowError,
  CircleCancelledError,
  RpcError,
  ProvingError,
  InvalidInputError,
  describeError,
} from "../../packages/client/src/errors.js";

export { networkOf, NETWORKS } from "../../packages/client/src/networks.js";
export { makeCircleId } from "../../packages/client/src/brand.js";
export type { CircleId } from "../../packages/client/src/brand.js";

/** Read-only client stub — the UI only ever passes it back into other stubs. */
export async function connectReadOnly(_config: unknown): Promise<unknown> {
  return {};
}
