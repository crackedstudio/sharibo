import {
  connect,
  createCircle,
  fund,
  claim,
  expireRound,
  proposeAdmin,
  acceptAdmin,
  getCircle,
  getVk,
  getCircleCount,
  getStatus,
  hasClaimed,
  getStatus,
  cancelCircle,
  getCircleStatus,
  getRound,
  getPot,
  getContributors,
  estimateClaimFee,
  type ShariboNetworkConfig,
  type ShariboSigner,
  type TxResult,
} from "./contract.js";
import { Keypair } from "@stellar/stellar-sdk";
import { DEFAULT_RETRY_POLICY, type RetryPolicy } from "./retry.js";
import type { CircleId, NullifierHash, ExternalNullifier } from "./brand.js";

export interface ShariboSDKOptions {
  /**
   * Default retry policy for every contract call made through this instance.
   * Individual methods accept an optional per-call override that takes precedence.
   */
  retryPolicy?: RetryPolicy;
}

export interface CreateCircleArgs {
  admin: string;
  token: string;
  root: bigint;
  contribution: bigint;
  size: number;
  vk: ContractVerificationKey;
  /** Protocol fee in basis points (0-10_000; 0 = no fee). */
  feeBps: number;
  /** Address the protocol fee is paid to (required when feeBps > 0). */
  feeRecipient: string;
}

export interface FundArgs {
  circleId: CircleId;
  from: string;
}

export interface ClaimArgs {
  circleId: CircleId;
  recipient: string;
  nullifierHash: NullifierHash;
  externalNullifier: ExternalNullifier;
  proof: ContractProof;
}

export interface ExpireRoundArgs {
  circleId: bigint;
}

export interface ProposeAdminArgs {
  circleId: bigint;
  newAdmin: string;
}

export interface AcceptAdminArgs {
  circleId: bigint;
}

/**
 * Object-oriented facade over the free functions in `contract.ts`.
 *
 * Each method is a thin delegation that threads the connected `client` and
 * the configured `retryPolicy` through to the corresponding free function,
 * so callers don't have to pass them by hand. The free functions remain the
 * low-level layer (see `docs/adr/003-client-boundary.md`); this facade is the
 * recommended entry point for application code.
 */
export class ShariboSDK {
  /** The network configuration this instance was created with. */
  readonly networkConfig: ShariboNetworkConfig;
  /** The raw contract client. Exposed for escape hatches the facade doesn't cover yet. */
  readonly client: ShariboClient;
  /** The default retry policy applied when a call does not pass its own. */
  readonly retryPolicy: RetryPolicy;
  /** Public key of the signer this instance transacts as. */
  readonly publicKey: string;
  /** The keypair or wallet signer this instance signs with. */
  readonly signer: Keypair | ShariboSigner;

  private constructor(
    networkConfig: ShariboNetworkConfig,
    client: ShariboClient,
    retryPolicy: RetryPolicy,
    publicKey: string,
    signer: Keypair | ShariboSigner,
  ) {
    this.networkConfig = networkConfig;
    this.client = client;
    this.retryPolicy = retryPolicy;
  }

  static async connect(
    config: ShariboNetworkConfig,
    keypairOrSigner: Keypair | ShariboSigner,
    retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
  ): Promise<ShariboSDK> {
    const client = await connect(config, keypairOrSigner);
    return new ShariboSDK(client, retryPolicy);
  }

  private policy(override?: RetryPolicy): RetryPolicy {
    return override ?? this.retryPolicy;
  }

  /** Creates a new circle. Mirrors the `createCircle` free function. */
  createCircle(args: CreateCircleArgs, retryPolicy?: RetryPolicy): Promise<TxResult<bigint>> {
    return createCircle(this.client, args, this.policy(retryPolicy));
  }

  /** Funds a circle from `args.from`. Mirrors the `fund` free function. */
  fund(args: FundArgs, retryPolicy?: RetryPolicy): Promise<TxResult<void>> {
    return fund(this.client, args, this.policy(retryPolicy));
  }

  /** Claims the pot for `args.recipient`. Mirrors the `claim` free function. */
  claim(args: ClaimArgs, retryPolicy?: RetryPolicy): Promise<TxResult<void>> {
    return claim(this.client, args, this.policy(retryPolicy));
  }

  /**
   * Expires a stalled round so contributors can recover their funds without
   * the admin key. Mirrors the `expireRound` free function.
   */
  expireRound(args: ExpireRoundArgs): Promise<TxResult<void>> {
    return expireRound(this.client, args, this.retryPolicy);
  }

  /** Proposes a new admin for key rotation. Mirrors the `proposeAdmin` free function. */
  proposeAdmin(args: ProposeAdminArgs): Promise<TxResult<void>> {
    return proposeAdmin(this.client, args, this.retryPolicy);
  }

  /** Accepts a pending admin proposal. Mirrors the `acceptAdmin` free function. */
  acceptAdmin(args: AcceptAdminArgs): Promise<TxResult<void>> {
    return acceptAdmin(this.client, args, this.retryPolicy);
  }

  /** Reads a circle's current state. Mirrors the `getCircle` free function. */
  getCircle(circleId: bigint, retryPolicy?: RetryPolicy): Promise<CircleView> {
    return getCircle(this.client, circleId, this.policy(retryPolicy));
  }

  /**
   * Reads a circle's verification key, cached per (contract, circle) for the
   * session. Mirrors the `getVk` free function.
   */
  getVk(circleId: bigint): Promise<ContractVerificationKey> {
    return getVk(this.client, circleId, this.retryPolicy);
  }

  /** Pure read: how many circles have been created on this contract. */
  getCircleCount(retryPolicy?: RetryPolicy): Promise<bigint> {
    return getCircleCount(this.client, this.policy(retryPolicy));
  }

  /**
   * Reads a circle's contract-level status (round, pot, pot target, cancelled).
   * Mirrors the `getStatus` free function, which wraps the contract's
   * `get_status` read.
   */
  getStatus(retryPolicy?: RetryPolicy): Promise<bigint> {
    return this.getCircleCount(retryPolicy);
  }

  /** Pure read: whether `nullifierHash` already claimed in this circle. */
  hasClaimed(circleId: bigint, nullifierHash: bigint, retryPolicy?: RetryPolicy): Promise<boolean> {
    return hasClaimed(this.client, circleId, nullifierHash, this.policy(retryPolicy));
  }
}
