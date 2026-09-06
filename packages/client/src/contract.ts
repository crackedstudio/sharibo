import { networkOf } from "./networks.js";
import { Client as ContractClient, basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Keypair } from "@stellar/stellar-sdk";
import { Api } from "@stellar/stellar-sdk/rpc";
import type { ContractProof, ContractVerificationKey } from "./prove.js";
import { ContractError, RpcError, InvalidInputError } from "./errors.js";
import { decodeContractError } from "./decodeError.js";
import { withRetry, DEFAULT_RETRY_POLICY, type RetryPolicy } from "./retry.js";
import { validateContractProof, validateContractVerificationKey } from "./validate.js";
import { SdkEventEmitter, type OnEventFn } from "./events.js";

/**
 * Configuration required to connect to the Sharibo contract.
 *
 * @property contractId - The Stellar contract ID.
 * @property rpcUrl - The RPC URL for the Stellar network.
 * @property networkPassphrase - The network passphrase.
 * @property onEvent - Optional callback for observability events.
 */
export interface ShariboNetworkConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  onEvent?: OnEventFn;
}

/**
 * A Sharibo contract client with dynamically attached methods.
 *
 * The contract's methods (create_circle/fund/claim/get_circle/has_claimed)
 * are attached to the Client at runtime from the on-chain contract spec (see
 * @stellar/stellar-sdk's `contract.Client.from`), so they aren't visible to
 * TypeScript's static checker — hence `any` here rather than a hand-rolled
 * or codegen'd interface. Keeps this SDK working against whatever the
 * deployed contract's real spec is, rather than a copy that can drift.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ShariboClient = any;

/**
 * The transaction builder the dynamically-typed contract client returns from
 * each contract method (create_circle/fund/claim/get_circle/...). Kept as
 * `any` for the same reason as `ShariboClient` — the shape is defined by the
 * on-chain spec, not by a hand-rolled interface. It exposes `signAndSend`,
 * whose result shape is documented by `populateTxResult`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContractTx = any;

export interface ShariboSigner {
  publicKey: string;
  signTransaction: (txXdr: string, opts?: unknown) => Promise<string>;
  signAuthEntry?: (entryXdr: string, opts?: unknown) => Promise<string>;
}

export interface ResolvedSigner {
  publicKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signTransaction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signAuthEntry: any;
}

export interface ResolvedSigner {
  publicKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signTransaction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signAuthEntry: any;
}

/**
 * Turns a keypair or a wallet signer into the pieces the contract client
 * needs, without constructing the client. Shared by `connect` and the SDK
 * facade so both agree on who the signer is.
 */
export interface FeeEstimate {
  /** Minimum resource fee in stroops, as reported by simulation. */
  minResourceFee: bigint;
  /** Total fee (base + resource) encoded in the assembled transaction, in stroops. */
  totalFee: bigint;
}

export function resolveSigner(
  keypairOrSigner: Keypair | ShariboSigner,
  networkPassphrase: string,
): ResolvedSigner {
  if (keypairOrSigner instanceof Keypair) {
    const signer = basicNodeSigner(keypairOrSigner, networkPassphrase);
    return {
      publicKey: keypairOrSigner.publicKey(),
      signTransaction: signer.signTransaction,
      signAuthEntry: signer.signAuthEntry,
    };
  }
  return {
    publicKey: keypairOrSigner.publicKey,
    signTransaction: keypairOrSigner.signTransaction,
    signAuthEntry: keypairOrSigner.signAuthEntry,
  };
}

const contractClientCache = new Map<string, Promise<ShariboClient>>();

export function clearContractClientCache(): void {
  contractClientCache.clear();
}

export async function connect(
  config: ShariboNetworkConfig,
  keypairOrSigner: Keypair | ShariboSigner,
): Promise<ShariboClient> {
  const signer = resolveSigner(keypairOrSigner, config.networkPassphrase);

  const cacheKey = JSON.stringify([
    config.contractId,
    config.rpcUrl,
    config.networkPassphrase,
    signer.publicKey,
  ]);

  const cached = contractClientCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const emitter = new SdkEventEmitter(config.onEvent);
  const clientPromise = ContractClient.from({
    contractId: config.contractId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: signer.publicKey,
    signTransaction: signer.signTransaction,
    signAuthEntry: signer.signAuthEntry,
  });

  contractClientCache.set(cacheKey, clientPromise);

  try {
    const client: ShariboClient = await clientPromise;
    client.emitter = emitter;
    return client;
  } catch (error) {
    contractClientCache.delete(cacheKey);
    throw error;
  }
}

/**
 * Build a read-only contract client that can simulate view calls without a
 * signer, a funded account, or any fee payment.
 *
 * Use this for {@link getCircle}, {@link getCircleCount}, and
 * {@link hasClaimed}.  The returned client must **not** be passed to
 * write-path functions (`fund`, `claim`, `createCircle`) — those require a
 * signed client from {@link connect}.
 */
export async function connectReadOnly(
  config: ShariboNetworkConfig,
): Promise<ShariboClient> {
  return ContractClient.from({
    contractId: config.contractId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    // publicKey omitted — the SDK accepts undefined for simulation-only calls
  });
}

/**
 * Result of a contract transaction.
 *
 * @template T - The type of the transaction result.
 * @property result - The return value from the contract method.
 * @property hash - The transaction hash.
 */
export interface TxResult<T> {
  result: T;
  hash: string;
  /** Ledger sequence number the transaction was included in, if available. */
  ledger?: number;
  /** Fee charged for the transaction in stroops, if available. */
  feeCharged?: string;
}

/**
 * Known Stellar network passphrases mapped to their stellar.expert path
 * segment (the part after "https://stellar.expert/explorer/").
 *
 * Only networks that stellar.expert actually hosts are listed here.
 * Any passphrase not in this map is unknown — callers receive `null`
 * instead of a silently wrong URL (e.g. futurenet would otherwise
 * receive a testnet URL, which is misleading).
 */
export const EXPLORER_NETWORKS: ReadonlyMap<string, string> = new Map([
  // Mainnet — "Public Global Stellar Network ; September 2015"
  ["Public Global Stellar Network ; September 2015", "public"],
  // Testnet — "Test SDF Network ; September 2015"
  ["Test SDF Network ; September 2015", "testnet"],
]);

/**
 * Build a Stellar explorer URL for a transaction hash, network-aware.
 *
 * Returns `null` for any network passphrase that stellar.expert does not
 * host (futurenet, custom networks, etc.) so callers can decide whether to
 * show a link at all, rather than silently linking to the wrong network.
 *
 * @param hash - Transaction hash (hex string).
 * @param networkPassphrase - Stellar network passphrase.
 * @returns A fully-qualified stellar.expert URL.
 */
export function explorerTxUrl(hash: string, networkPassphrase: string): string | null {
  const network = EXPLORER_NETWORKS.get(networkPassphrase);
  if (network === undefined) return null;
  return `https://stellar.expert/explorer/${network}/tx/${hash}`;
}


function populateTxResult<T>(
  result: T,
  sent: { sendTransactionResponse: { hash: string }; getTransactionResponse?: { ledger?: number; feeCharged?: string } },
): TxResult<T> {
  return {
    result,
    hash: sent.sendTransactionResponse.hash,
    ledger: sent.getTransactionResponse?.ledger,
    feeCharged: sent.getTransactionResponse?.feeCharged,
  };
}

/**
 * Estimates the fee for a claim transaction by running a dry-run simulation.
 *
 * The claim is the most expensive operation in Sharibo because it includes
 * a BLS12-381 pairing check. This lets the UI show the cost before the user
 * signs anything.
 *
 * @param client - The Sharibo contract client (connected with the signer that
 *   will submit the transaction — the fee is account-specific).
 * @param args - The same arguments you would pass to `claim()`.
 * @returns A fee estimate in stroops, or null if simulation fails.
 */
export async function estimateClaimFee(
  client: ShariboClient,
  args: {
    circleId: bigint;
    recipient: string;
    nullifierHash: bigint;
    externalNullifier: bigint;
    proof: ContractProof;
  },
): Promise<FeeEstimate | null> {
  try {
    const tx: ContractTx = await withRetry(() =>
      client.claim({
        circle_id: args.circleId,
        recipient: args.recipient,
        nullifier_hash: args.nullifierHash,
        external_nullifier: args.externalNullifier,
        proof: args.proof,
      }),
    );
    // tx has already been simulated by the SDK at this point.
    const sim = tx.simulation as Api.SimulateTransactionResponse | undefined;
    if (!sim || !Api.isSimulationSuccess(sim)) return null;

    const minResourceFee = BigInt(sim.minResourceFee);
    // tx.built is the assembled Transaction; its .fee is total stroops as a string.
    const totalFee = tx.built ? BigInt(tx.built.fee) : minResourceFee;
    return { minResourceFee, totalFee };
  } catch {
    // Simulation can fail (e.g. circle underfunded, wrong round) — don't
    // surface that as an error here; the actual claim() call will report it.
    return null;
  }
}

/**
 * Creates a new Sharibo circle.
 *
 * @param client - The Sharibo contract client.
 * @param args - Circle creation parameters.
 * @param args.admin - The admin address for the circle.
 * @param args.token - The token address for contributions.
 * @param args.root - The Merkle tree root of identity commitments.
 * @param args.contribution - The required contribution amount per participant.
 * @param args.size - The maximum number of participants.
 * @param args.vk - The verification key for the zero-knowledge proof circuit.
 * @param args.feeBps - The protocol fee in basis points (0-10_000; 0 = no fee).
 * @param args.feeRecipient - The address the protocol fee is paid to.
 * @returns The circle ID and transaction hash.
 */
export async function createCircle(
  client: ShariboClient,
  args: {
    admin: string;
    token: string;
    root: bigint;
    contribution: bigint;
    size: number;
    vk: ContractVerificationKey;
    feeBps: number;
    feeRecipient: string;
  },
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<TxResult<bigint>> {
  if (args.size === 0 || args.contribution <= 0n || args.vk.ic.length !== 4) {
    throw new InvalidInputError(
      "InvalidCircleParams: size must be > 0, contribution must be > 0, and vk.ic must have length 4",
    );
  }
  if (args.feeBps < 0 || args.feeBps > 10_000) {
    throw new InvalidInputError(
      "InvalidFeeParams: feeBps must be between 0 and 10_000",
    );
  }
  if (args.feeBps > 0 && args.feeRecipient === '') {
    throw new InvalidInputError(
      "InvalidFeeParams: feeRecipient is required when feeBps > 0",
    );
  }
  validateContractVerificationKey(args.vk);
  try {
    const tx: ContractTx = await withRetry(() => client.create_circle({
      admin: args.admin,
      token: args.token,
      root: args.root,
      contribution: args.contribution,
      size: args.size,
      vk: args.vk,
      fee_bps: args.feeBps,
      fee_recipient: args.feeRecipient,
    }), retryPolicy, client.emitter);
    const sent = await tx.signAndSend();
    return populateTxResult(sent.result as bigint, sent);
  } catch (err) {
    throw decodeContractError(err);
  }
}

/**
 * Funds a circle with a contribution.
 *
 * @param client - The Sharibo contract client.
 * @param args - Funding parameters.
 * @param args.circleId - The ID of the circle to fund.
 * @param args.from - The address sending the contribution.
 * @returns The transaction hash.
 */
export async function fund(
  client: ShariboClient,
  args: { circleId: bigint; from: string },
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<TxResult<void>> {
  try {
    const tx: ContractTx = await withRetry(() => client.fund({ circle_id: args.circleId, from: args.from }), retryPolicy, client.emitter);
    const sent = await tx.signAndSend();
    return populateTxResult(undefined, sent);
  } catch (err) {
    throw decodeContractError(err);
  }
}

/**
 * Claims a reward from a circle using a zero-knowledge proof.
 *
 * @param client - The Sharibo contract client.
 * @param args - Claim parameters.
 * @param args.circleId - The ID of the circle to claim from.
 * @param args.recipient - The address to receive the reward.
 * @param args.nullifierHash - The nullifier hash to prevent double-claiming.
 * @param args.externalNullifier - The external nullifier binding to circle and round.
 * @param args.proof - The Groth16 zero-knowledge proof.
 * @returns The transaction hash.
 */
export async function claim(
  client: ShariboClient,
  args: {
    circleId: bigint;
    recipient: string;
    nullifierHash: bigint;
    externalNullifier: bigint;
    proof: ContractProof;
  },
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<TxResult<void>> {
  validateContractProof(args.proof);
  try {
    const tx: ContractTx = await withRetry(() => client.claim({
      circle_id: args.circleId,
      recipient: args.recipient,
      nullifier_hash: args.nullifierHash,
      external_nullifier: args.externalNullifier,
      proof: args.proof,
    }), retryPolicy, client.emitter);
    const sent = await tx.signAndSend();
    return populateTxResult(undefined, sent);
  } catch (err) {
    throw decodeContractError(err);
  }
}

/**
 * A view of a Sharibo circle's state.
 *
 * @property admin - The admin address for the circle.
 * @property token - The token address for contributions.
 * @property root - The Merkle tree root of identity commitments.
 * @property contribution - The required contribution amount per participant.
 * @property size - The maximum number of participants.
 * @property round - The current round number.
 * @property pot - The total amount in the prize pot.
 * @property contributors - Addresses that have funded the current round in order.
 * @property cancelled - Whether the circle has been cancelled.
 * @property fee_bps - The protocol fee in basis points (0-10_000; 0 = no fee).
 * @property fee_recipient - The address the protocol fee is paid to.
 */
export interface CircleView {
  admin: string;
  token: string;
  root: bigint;
  contribution: bigint;
  size: number;
  round: number;
  pot: bigint;
  vk: ContractVerificationKey;
  contributors: string[];
  cancelled: boolean;
  fee_bps: number;
  fee_recipient: string;
}

/**
 * Retrieves the current state of a circle.
 *
 * Uses simulation only — no transaction is submitted, no fee is charged, and
 * no funded keypair is required.  Pass a client from {@link connectReadOnly}
 * (or any signed client; signing is simply ignored for view calls).
 *
 * @param client - The Sharibo contract client.
 * @param circleId - The ID of the circle to query.
 * @returns The circle's current state.
 */
export async function getCircle(
  client: ShariboClient,
  circleId: bigint,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<CircleView> {
  // get_circle is a pure read: the SDK detects no signature is needed and
  // refuses signAndSend() without `force` (there's nothing to sign/submit).
  try {
    const tx: ContractTx = await withRetry(() => client.get_circle({ circle_id: circleId }), retryPolicy, client.emitter);
    // Pure read — take the simulated result rather than submitting a tx (#279).
    return tx.result as CircleView;
  } catch (err) {
    throw decodeContractError(err);
  }
}

/**
 * The subset of a circle's state the funding UI polls for: how much is in the
 * pot and which accounts have contributed so far.
 *
 * A narrow view over {@link getCircle} so callers that only drive funding
 * progress don't depend on the full `CircleView` shape.
 */
export interface CircleStatus {
  pot: bigint;
  contributors: string[];
  round: number;
  cancelled: boolean;
}

/** Pure read: the funding-progress slice of a circle's on-chain state. */
export async function getCircleStatus(
  client: ShariboClient,
  circleId: bigint,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<CircleStatus> {
  const circle = await getCircle(client, circleId, retryPolicy);
  return {
    pot: circle.pot,
    contributors: circle.contributors ?? [],
    round: circle.round,
    cancelled: circle.cancelled,
  };
}

/** Pure read: the current count of circles ever created. 0 if none yet. */
export async function getCircleCount(
  client: ShariboClient,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<bigint> {
  try {
    const tx: ContractTx = await withRetry(() => client.get_circle_count(), retryPolicy, client.emitter);
    return tx.result as bigint;
  } catch (err) {
    throw decodeContractError(err);
  }
}

/** Pure read: the current round number for `circleId`. */
export async function getRound(client: ShariboClient, circleId: bigint): Promise<number> {
  const tx: ContractTx = await withRetry(() => client.get_round({ circle_id: circleId }));
  return Number(tx.result);
}

/** Pure read: the current pot balance (in token stroops) for `circleId`. */
export async function getPot(client: ShariboClient, circleId: bigint): Promise<bigint> {
  const tx: ContractTx = await withRetry(() => client.get_pot({ circle_id: circleId }));
  return BigInt(tx.result);
}

/**
 * Pure read: compact status tuple `(round, pot, target, cancelled)`.
 *
 * @returns `[round, pot, target, cancelled]` for `circleId`.
 */
export async function getStatus(
  client: ShariboClient,
  circleId: bigint,
): Promise<{ round: number; pot: bigint; target: bigint; cancelled: boolean }> {
  const tx: ContractTx = await withRetry(() => client.get_status({ circle_id: circleId }));
  const [round, pot, target, cancelled] = tx.result as
    [bigint | number, bigint | string, bigint | string, boolean];
  return {
    round: Number(round),
    pot: BigInt(pot),
    target: BigInt(target),
    cancelled,
  };
}

/** Pure read: the ordered list of addresses that funded the current round. */
export async function getContributors(client: ShariboClient, circleId: bigint): Promise<string[]> {
  const tx: ContractTx = await withRetry(() => client.get_contributors({ circle_id: circleId }));
  return tx.result as string[];
}

/**
 * Pure read: whether `nullifierHash` has already claimed in this circle.
 *
 * Uses simulation only — no transaction is submitted, no fee is charged, and
 * no funded keypair is required.
 */
export async function hasClaimed(
  client: ShariboClient,
  circleId: bigint,
  nullifierHash: bigint,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<boolean> {
  // `has_claimed` is a pure read — don't submit or force a transaction.
  // The SDK returns the raw result for read-only contract calls, so just
  // invoke it and return the boolean directly.
  const tx: ContractTx = await withRetry(() => client.has_claimed({
    circle_id: circleId,
    nullifier_hash: nullifierHash,
  }), retryPolicy, client.emitter);
  return tx.result as boolean;
}

/**
 * Cancels a circle, refunding all contributors and permanently closing it.
 *
 * Only the circle admin can call this. It refunds all contributors for the
 * current round, sets the circle as cancelled, and clears the pot and contributors.
 *
 * @param client - The Sharibo contract client.
 * @param args - Cancel parameters.
 * @param args.circleId - The ID of the circle to cancel.
 * @returns The transaction hash.
 */
export async function cancelCircle(
  client: ShariboClient,
  args: { circleId: bigint },
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<TxResult<void>> {
  try {
    const tx: ContractTx = await withRetry(() => client.cancel_circle({ circle_id: args.circleId }), retryPolicy, client.emitter);
    const sent = await tx.signAndSend();
    return populateTxResult(undefined, sent);
  } catch (err) {
    throw decodeContractError(err);
  }
}

