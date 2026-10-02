import { Keypair } from "@stellar/stellar-sdk";
import {
  connect,
  resolveSigner,
  createCircle,
  fund,
  claim,
  getCircle,
  getCircleCount,
  hasClaimed,
  type ShariboNetworkConfig,
  type ShariboSigner,
  type ShariboClient,
  type TxResult,
  type CircleView,
} from "./contract.js";
import type { ContractProof, ContractVerificationKey } from "./prove.js";
import { DEFAULT_RETRY_POLICY, type RetryPolicy } from "./retry.js";

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
  circleId: bigint;
  from: string;
}

export interface ClaimArgs {
  circleId: bigint;
  recipient: string;
  nullifierHash: bigint;
  externalNullifier: bigint;
  proof: ContractProof;
}

/**
 * A ShariboSDK facade for interacting with the Sharibo contract.
 *
 * Holds the contract client, the network config, and the retry policy once at
 * creation, so callers stop threading an untyped `client` through every call:
 *
 *   const sdk = await ShariboSDK.connect(config, signer);
 *   const { result: circleId } = await sdk.createCircle({ ... });
 *   await sdk.fund({ circleId, from });
 *   await sdk.claim({ circleId, ... });
 *
 * `connect` is async because it resolves the signer and constructs the
 * underlying @stellar/stellar-sdk contract client.
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
    this.publicKey = publicKey;
    this.signer = signer;
  }

  /**
   * Creates an SDK instance bound to one signer and one network.
   *
   * @param config - Network configuration (contract id, RPC url, passphrase).
   * @param keypairOrSigner - Keypair, or a wallet-style signer.
   * @param options - Optional overrides (e.g. a custom retry policy).
   */
  static async connect(
    config: ShariboNetworkConfig,
    keypairOrSigner: Keypair | ShariboSigner,
    options: ShariboSDKOptions = {},
  ): Promise<ShariboSDK> {
    const client = await connect(config, keypairOrSigner);
    const { publicKey } = resolveSigner(keypairOrSigner, config.networkPassphrase);
    return new ShariboSDK(
      config,
      client,
      options.retryPolicy ?? DEFAULT_RETRY_POLICY,
      publicKey,
      keypairOrSigner,
    );
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

  /** Reads a circle's current state. Mirrors the `getCircle` free function. */
  getCircle(circleId: bigint, retryPolicy?: RetryPolicy): Promise<CircleView> {
    return getCircle(this.client, circleId, this.policy(retryPolicy));
  }

  /** Pure read: how many circles have been created on this contract. */
  getCircleCount(retryPolicy?: RetryPolicy): Promise<bigint> {
    return getCircleCount(this.client, this.policy(retryPolicy));
  }

  /**
   * Contract-level status: the number of circles ever created on the deployed
   * contract. Listed in issue #284's sketch of the facade API; implemented
   * over the contract's existing read (there is no `get_status` contract
   * method), so this is an alias for `getCircleCount`.
   */
  getStatus(retryPolicy?: RetryPolicy): Promise<bigint> {
    return this.getCircleCount(retryPolicy);
  }

  /** Pure read: whether `nullifierHash` already claimed in this circle. */
  hasClaimed(circleId: bigint, nullifierHash: bigint, retryPolicy?: RetryPolicy): Promise<boolean> {
    return hasClaimed(this.client, circleId, nullifierHash, this.policy(retryPolicy));
  }
}
