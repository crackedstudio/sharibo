import { Client as ContractClient, basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { Api } from "@stellar/stellar-sdk/rpc";
import type { ContractProof, ContractVerificationKey } from "./prove.js";
import { ContractError, RpcError } from "./errors.js";
import { decodeContractError } from "./decodeError.js";

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

export interface ShariboSigner {
  publicKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signTransaction: (txXdr: string, opts?: any) => Promise<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signAuthEntry?: (entryXdr: string, opts?: any) => Promise<string>;
}

/**
 * Pre-flight fee estimate from a dry-run simulation.
 *
 * All values are in stroops (1 XLM = 10,000,000 stroops).
 *
 * @property minResourceFee - The minimum fee the network requires to cover
 *   resource usage (CPU, memory, I/O) as reported by the simulation. For a
 *   claim this is dominated by the BLS12-381 pairing check.
 * @property totalFee - The full fee encoded in the assembled transaction
 *   (base inclusion fee + minResourceFee). This is what the account will
 *   actually be charged if the transaction is accepted.
 */
export interface FeeEstimate {
  /** Minimum resource fee in stroops, as reported by simulation. */
  minResourceFee: bigint;
  /** Total fee (base + resource) encoded in the assembled transaction, in stroops. */
  totalFee: bigint;
}

// ── withRetry ────────────────────────────────────────────────────────────────
// Retries the simulation/preparation phase of a contract call on transient
// errors (429 / 503 / timeouts). The submit phase is never retried — once a
// transaction is signed and sent, retrying could cause a double-spend.

const RETRY_DELAYS_MS = [500, 1000, 2000];

function isTransient(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err);
  return (
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("timeout") ||
    msg.includes("ECONNRESET") ||
    msg.includes("Too Many Requests")
  );
}

async function withRetry<T = any>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_DELAYS_MS.length && isTransient(err)) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function connect(
  config: ShariboNetworkConfig,
  keypairOrSigner: Keypair | ShariboSigner,
): Promise<ShariboClient> {
  let publicKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let signTransaction: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let signAuthEntry: any;

  if (keypairOrSigner instanceof Keypair) {
    const signer = basicNodeSigner(keypairOrSigner, config.networkPassphrase);
    publicKey = keypairOrSigner.publicKey();
    signTransaction = signer.signTransaction;
    signAuthEntry = signer.signAuthEntry;
  } else {
    publicKey = keypairOrSigner.publicKey;
    signTransaction = keypairOrSigner.signTransaction;
    signAuthEntry = keypairOrSigner.signAuthEntry;
  }

  return ContractClient.from({
    contractId: config.contractId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey,
    signTransaction,
    signAuthEntry,
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

/**
 * Maximum number of retry attempts for transient RPC errors (429, 5xx).
 * Contract errors ("Error(Contract, #N)") are never retried — they are
 * deterministic and will fail identically on every attempt.
 */
const MAX_RETRIES = 3;

/**
 * Returns `true` when the error looks like a transient RPC failure that
 * is safe to retry (rate-limit, server timeout, gateway error, etc.).
 */
function isTransientRpcError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  // Match common transient HTTP status codes and SDK-level wording.
  return (
    /\b(429|5[0-9]{2})\b/.test(msg) ||
    /Too Many Requests/i.test(msg) ||
    /rate.?limit/i.test(msg) ||
    /timeout/i.test(msg) ||
    /Gateway Timeout/i.test(msg) ||
    /Service Unavailable/i.test(msg)
  );
}

/**
 * Wrap an async operation with retry-on-transient-error semantics.
 *
 * Only retries when `isTransientRpcError` returns `true`; contract errors
 * ("Error(Contract, #N)") are deterministic and immediately re-thrown as
 * typed subclasses via `decodeContractError`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withRetry(fn: () => Promise<any>): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Contract errors are deterministic — never retry them.
      const decoded = decodeContractError(err);
      if (decoded instanceof ContractError) {
        throw decoded;
      }

      // Transient RPC error — retry with backoff if attempts remain.
      if (isTransientRpcError(err) && attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 200));
        continue;
      }

      // Non-transient or exhausted retries — throw as RpcError.
      throw decoded;
    }
  }
  // Exhausted retries for transient error — wrap and throw.
  throw decodeContractError(lastError);
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
    const tx = await withRetry(() =>
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
): Promise<TxResult<bigint>> {
  try {
    const tx = await withRetry(() => client.create_circle({
      admin: args.admin,
      token: args.token,
      root: args.root,
      contribution: args.contribution,
      size: args.size,
      vk: args.vk,
    }));
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
): Promise<TxResult<void>> {
  try {
    const tx = await withRetry(() => client.fund({ circle_id: args.circleId, from: args.from }));
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
): Promise<TxResult<void>> {
  try {
    const tx = await withRetry(() => client.claim({
      circle_id: args.circleId,
      recipient: args.recipient,
      nullifier_hash: args.nullifierHash,
      external_nullifier: args.externalNullifier,
      proof: args.proof,
    }));
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
export async function getCircle(client: ShariboClient, circleId: bigint): Promise<CircleView> {
  // get_circle is a pure read: the SDK detects no signature is needed and
  // refuses signAndSend() without `force` (there's nothing to sign/submit).
  try {
    const tx = await withRetry(() => client.get_circle({ circle_id: circleId }));
    const sent = await tx.signAndSend({ force: true });
    return sent.result;
  } catch (err) {
    throw decodeContractError(err);
  }
}

/** Pure read: the current count of circles ever created. 0 if none yet. */
export async function getCircleCount(client: ShariboClient): Promise<bigint> {
  try {
    const tx = await client.get_circle_count();
    const sent = await tx.signAndSend({ force: true });
    return sent.result as bigint;
  } catch (err) {
    throw decodeContractError(err);
  }
}

/** Pure read: whether `nullifierHash` has already claimed in this circle. */
export async function hasClaimed(
  client: ShariboClient,
  circleId: bigint,
  nullifierHash: bigint,
): Promise<boolean> {
  try {
    const tx = await withRetry(() => client.has_claimed({
      circle_id: circleId,
      nullifier_hash: nullifierHash,
    }));
    const sent = await tx.signAndSend({ force: true });
    return sent.result;
  } catch (err) {
    throw decodeContractError(err);
  }
}
