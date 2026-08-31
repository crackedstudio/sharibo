import { Client as ContractClient, basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import type { ContractProof, ContractVerificationKey } from "./prove.js";
import { ContractError, RpcError } from "./errors.js";
import { withRetry, DEFAULT_RETRY_POLICY, type RetryPolicy } from "./retry.js";

/**
 * Network configuration for connecting to the Sharibo contract.
 *
 * @property contractId - The Stellar contract ID.
 * @property rpcUrl - The RPC URL for the Stellar network.
 * @property networkPassphrase - The network passphrase (e.g., "Test SDF Network").
 */
export interface ShariboNetworkConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signTransaction: (txXdr: string, opts?: any) => Promise<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signAuthEntry?: (entryXdr: string, opts?: any) => Promise<string>;
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

export async function connect(
  config: ShariboNetworkConfig,
  keypairOrSigner: Keypair | ShariboSigner,
): Promise<ShariboClient> {
  const signer = resolveSigner(keypairOrSigner, config.networkPassphrase);

  return ContractClient.from({
    contractId: config.contractId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: signer.publicKey,
    signTransaction: signer.signTransaction,
    signAuthEntry: signer.signAuthEntry,
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
 * Build a Stellar explorer URL for a transaction hash, network-aware.
 *
 * @param hash - Transaction hash (hex string).
 * @param networkPassphrase - Stellar network passphrase (e.g. "Test SDF Network ; September 2015").
 * @returns A fully-qualified stellar.expert URL.
 */
export function explorerTxUrl(hash: string, networkPassphrase: string): string {
  const subdomain = networkPassphrase.includes("Public Global")
    ? "" // mainnet — no subdomain prefix
    : "testnet.";
  return `https://${subdomain}stellar.expert/explorer/tx/${hash}`;
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
  },
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<TxResult<bigint>> {
  const tx: ContractTx = await withRetry(() => client.create_circle({
    admin: args.admin,
    token: args.token,
    root: args.root,
    contribution: args.contribution,
    size: args.size,
    vk: args.vk,
  }), retryPolicy);
  const sent = await tx.signAndSend();
  return populateTxResult(sent.result as bigint, sent);
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
  const tx: ContractTx = await withRetry(() => client.fund({ circle_id: args.circleId, from: args.from }), retryPolicy);
  const sent = await tx.signAndSend();
  return populateTxResult(undefined, sent);
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
  const tx: ContractTx = await withRetry(() => client.claim({
    circle_id: args.circleId,
    recipient: args.recipient,
    nullifier_hash: args.nullifierHash,
    external_nullifier: args.externalNullifier,
    proof: args.proof,
  }), retryPolicy);
  const sent = await tx.signAndSend();
  return populateTxResult(undefined, sent);
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
 */
export interface CircleView {
  admin: string;
  token: string;
  root: bigint;
  contribution: bigint;
  size: number;
  round: number;
  pot: bigint;
}

/**
 * Retrieves the current state of a circle.
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
  const tx: ContractTx = await withRetry(() => client.get_circle({ circle_id: circleId }), retryPolicy);
  const sent = await tx.signAndSend({ force: true });
  return sent.result;
}

/** Pure read: the current count of circles ever created. 0 if none yet. */
export async function getCircleCount(
  client: ShariboClient,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<bigint> {
  const tx: ContractTx = await withRetry(() => client.get_circle_count(), retryPolicy);
  const sent = await tx.signAndSend({ force: true });
  return sent.result as bigint;
}

/** Pure read: whether `nullifierHash` has already claimed in this circle. */
export async function hasClaimed(
  client: ShariboClient,
  circleId: bigint,
  nullifierHash: bigint,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<boolean> {
  const tx: ContractTx = await withRetry(() => client.has_claimed({
    circle_id: circleId,
    nullifier_hash: nullifierHash,
  }), retryPolicy);
  const sent = await tx.signAndSend({ force: true });
  return sent.result;
}
