import { networkOf } from "./networks.js";
import { Client as ContractClient, basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { Keypair } from "@stellar/stellar-sdk";
import { Api } from "@stellar/stellar-sdk/rpc";
import type { ContractProof, ContractVerificationKey } from "./prove.js";
import { ContractError, RpcError, InvalidInputError } from "./errors.js";
import { decodeContractError } from "./decodeError.js";
import { withRetry, DEFAULT_RETRY_POLICY, type RetryPolicy } from "./retry.js";
import {
  validateContractProof,
  validateContractVerificationKey,
  assertInField,
} from "./validate.js";
import { SdkEventEmitter, type OnEventFn } from "./events.js";
import {
  type CircleId,
  type NullifierHash,
  type ExternalNullifier,
  makeCircleId,
} from "./brand.js";
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

const CONTRACT_CLIENT_CACHE_LIMIT = 16;
const contractClientCache = new Map<string, Promise<ShariboClient>>();

/**
 * Cache of fetched verification keys, keyed by `${contractId}:${circleId}`.
 *
 * The VK is committed at circle creation and never changes, so it is fetched
 * at most once per circle per session (see {@link getVk}). Cleared alongside
 * the contract-client cache so a network/contract switch invalidates it.
 */
const vkCache = new Map<string, ContractVerificationKey>();

export function clearContractClientCache(): void {
  contractClientCache.clear();
  vkCache.clear();
}

/**
 * Best-effort extraction of the contract id a client was built for, used to
 * key {@link vkCache}. Falls back to an empty string for clients that don't
 * expose their options (e.g. hand-rolled test doubles).
 */
function contractIdOf(client: ShariboClient): string {
  const options = (client as { options?: { contractId?: unknown } } | undefined)?.options;
  return typeof options?.contractId === "string" ? options.contractId : "";
}

export async function connect(
  config: ShariboNetworkConfig,
  keypairOrSigner: Keypair | ShariboSigner,
): Promise<ShariboClient> {
  const signer = resolveSigner(keypairOrSigner, config.networkPassphrase);
  // Signed key: mode, contractId, rpcUrl, networkPassphrase, signer public key.
  // Read-only uses its own mode key without a signer. onEvent is excluded and
  // replaced on each call because callbacks are per-caller, not client identity.
  const cacheKey = JSON.stringify([
    "signed",
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
    client.networkPassphrase = config.networkPassphrase;
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
export async function connectReadOnly(config: ShariboNetworkConfig): Promise<ShariboClient> {
  const cacheKey = JSON.stringify([
    "read-only",
    config.contractId,
    config.rpcUrl,
    config.networkPassphrase,
  ]);
  return getCachedContractClient(
    cacheKey,
    () =>
      ContractClient.from({
        contractId: config.contractId,
        networkPassphrase: config.networkPassphrase,
        rpcUrl: config.rpcUrl,
        // publicKey omitted — the SDK accepts undefined for simulation-only calls
      }),
    config.onEvent,
  );
}

/**
 * Result of a state-changing contract transaction (createCircle / fund / claim / cancelCircle).
 *
 * @template T - Decoded return value from the contract method.
 */
export interface TxResult<T> {
  /** Decoded return value from the contract method (e.g. circle id for createCircle). */
  result: T;
  /** Transaction hash (hex) of the submitted Soroban transaction. Always present after a successful signAndSend. */
  hash: string;
  /**
   * Ledger sequence the transaction was included in.
   * Optional because some RPC responses omit `getTransactionResponse.ledger`
   * before finality is fully polled; when absent, explorers still work from `hash`.
   */
  ledger?: number;
  /**
   * Actual fee charged for the transaction, in stroops, as a bigint.
   * Optional because the RPC `getTransactionResponse` may not include `feeCharged`
   * on every transport; when present it is coerced to bigint at this boundary.
   */
  feeCharged?: bigint;
  /**
   * Network-aware stellar.expert URL for `hash`, or null when the passphrase is
   * unknown to EXPLORER_NETWORKS (futurenet / custom). Always set by populateTxResult
   * when a networkPassphrase is provided; otherwise undefined.
   */
  explorerUrl?: string | null;
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

/** Shape returned by @stellar/stellar-sdk contract method `signAndSend()`. */
export type SignAndSendResult = {
  result: unknown;
  sendTransactionResponse: { hash?: string };
  getTransactionResponse?: {
    ledger?: number;
    feeCharged?: string | number | bigint;
  };
};

function coerceFeeCharged(feeCharged: string | number | bigint | undefined): bigint | undefined {
  if (feeCharged === undefined) return undefined;
  return typeof feeCharged === "bigint" ? feeCharged : BigInt(feeCharged);
}

/**
 * Maps a successful `signAndSend()` payload to {@link TxResult}.
 * Exported for fixture tests; production callers use `fund` / `claim` / etc.
 */
export function populateTxResult<T>(
  result: T,
  sent: SignAndSendResult,
  networkPassphrase?: string,
): TxResult<T> {
  const hash = sent.sendTransactionResponse?.hash;
  if (hash === undefined || hash === "") {
    throw new Error("hash");
  }

  const txResult: TxResult<T> = {
    result,
    hash,
  };

  const ledger = sent.getTransactionResponse?.ledger;
  if (ledger !== undefined) {
    txResult.ledger = ledger;
  }

  const feeCharged = coerceFeeCharged(sent.getTransactionResponse?.feeCharged);
  if (feeCharged !== undefined) {
    txResult.feeCharged = feeCharged;
  }

  if (networkPassphrase !== undefined) {
    txResult.explorerUrl = explorerTxUrl(hash, networkPassphrase);
  }

  return txResult;
}

function networkPassphraseFromClient(client: ShariboClient): string | undefined {
  const pp = client?.networkPassphrase;
  return typeof pp === "string" ? pp : undefined;
}

/**
 * An estimate of the transaction fee costs for an operation.
 */
export interface FeeEstimate {
  /** Minimum resource fee in stroops, as reported by simulation. */
  minResourceFee: bigint;
  /** Total fee (base + resource) encoded in the assembled transaction, in stroops. */
  totalFee: bigint;
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
    circleId: CircleId;
    recipient: string;
    nullifierHash: NullifierHash;
    externalNullifier: ExternalNullifier;
    proof: ContractProof;
  },
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<FeeEstimate | null> {
  try {
    const tx: ContractTx = await withRetry(
      () =>
        client.claim({
          circle_id: args.circleId,
          recipient: args.recipient,
          nullifier_hash: args.nullifierHash,
          external_nullifier: args.externalNullifier,
          proof: args.proof,
        }),
      retryPolicy,
      client.emitter,
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
 * Shared by every write-path wrapper (`fund`, `claim`, `createCircle`,
 * `expireRound`, `proposeAdmin`, `acceptAdmin`) so they all agree on retry
 * policy, error decoding, and result shape.
 */
async function simulateSignAndSend<T>(
  build: () => Promise<ContractTx>,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<TxResult<CircleId>> {
  if (args.size === 0 || args.contribution <= 0n || args.vk.ic.length !== 4) {
    throw new InvalidInputError(
      "InvalidCircleParams: size must be > 0, contribution must be > 0, and vk.ic must have length 4",
    );
  }
  if (args.feeBps < 0 || args.feeBps > 10_000) {
    throw new InvalidInputError("InvalidFeeParams: feeBps must be between 0 and 10_000");
  }
  if (args.feeBps > 0 && args.feeRecipient === "") {
    throw new InvalidInputError("InvalidFeeParams: feeRecipient is required when feeBps > 0");
  }
  validateContractVerificationKey(args.vk);
  assertInField(args.root, "root");
  try {
    const tx = await withRetry(() => build(), retryPolicy);
    const sent = await tx.signAndSend();
    return populateTxResult(sent.result as bigint, sent, networkPassphraseFromClient(client));
  } catch (err) {
    throw decodeContractError(err);
  }
}

/**
 * Expire a stalled round so contributors can recover their funds without the
 * admin key (contract `expire_round`, error `RoundNotExpired = 12`).
 *
 * Only valid once the round deadline has passed; the contract rejects the
 * call with `RoundNotExpired` otherwise. Use {@link getRoundDeadline} to
 * learn how many ledgers remain before this call will succeed.
 */
export async function expireRound(
  client: ShariboClient,
  circleId: bigint | number,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<TxResult<void>> {
  try {
    const tx: ContractTx = await withRetry(
      () => client.fund({ circle_id: args.circleId, from: args.from }),
      retryPolicy,
      client.emitter,
    );
    const sent = await tx.signAndSend();
    return populateTxResult(undefined, sent, networkPassphraseFromClient(client));
  } catch (err) {
    throw decodeContractError(err);
  }
}

/**
 * Propose a new admin for a circle (contract `propose_admin`). The proposal
 * must be accepted by the nominee via {@link acceptAdmin} before it takes
 * effect. Used for key rotation.
 */
export async function proposeAdmin(
  client: ShariboClient,
  circleId: bigint | number,
  newAdmin: string,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<TxResult<void>> {
  validateContractProof(args.proof);
  assertInField(args.nullifierHash, "nullifierHash");
  assertInField(args.externalNullifier, "externalNullifier");
  try {
    const tx: ContractTx = await withRetry(
      () =>
        client.claim({
          circle_id: args.circleId,
          recipient: args.recipient,
          nullifier_hash: args.nullifierHash,
          external_nullifier: args.externalNullifier,
          proof: args.proof,
        }),
      retryPolicy,
      client.emitter,
    );
    const sent = await tx.signAndSend();
    return populateTxResult(undefined, sent, networkPassphraseFromClient(client));
  } catch (err) {
    throw decodeContractError(err);
  }
}

/**
 * A view of a Sharibo circle's state.
 *
 * Mirrors the contract's `CircleMeta`: the mutable/small fields, without the
 * embedded verification key or the contributors vector. Use {@link getVk}
 * for the one-time VK fetch and {@link getContributors} for the funder list.
 *
 * @property admin - The admin address for the circle.
 * @property token - The token address for contributions.
 * @property root - The Merkle tree root of identity commitments.
 * @property contribution - The required contribution amount per participant.
 * @property size - The maximum number of participants.
 * @property round - The current round number.
 * @property pot - The total amount in the prize pot.
 * @property vk - The Groth16 verification key. Optional: only populated when
 *   the caller has explicitly fetched it via {@link getVk} and attached it;
 *   the poll-friendly {@link getCircle} read never returns it.
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
  vk?: ContractVerificationKey;
  cancelled: boolean;
  fee_bps: number;
  fee_recipient: string;
}

/**
 * Retrieves the current state of a circle.
 *
 * Backed by the contract's `get_circle_meta` read, which excludes the
 * verification key (committed at creation and immutable — fetch it once via
 * {@link getVk}) and the contributors vector (see {@link getContributors}).
 * Uses simulation only — no transaction is submitted, no fee is charged, and
 * no funded keypair is required.  Pass a client from {@link connectReadOnly}
 * (or any signed client; signing is simply ignored for view calls).
 *
 * @param client - The Sharibo contract client.
 * @param circleId - The ID of the circle to query.
 * @returns The circle's current state.
 */
export async function acceptAdmin(
  client: ShariboClient,
  circleId: bigint | number,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<CircleView> {
  // get_circle_meta is a pure read: the SDK detects no signature is needed and
  // refuses signAndSend() without `force` (there's nothing to sign/submit).
  try {
    const tx: ContractTx = await withRetry(
      () => client.get_circle_meta({ circle_id: circleId }),
      retryPolicy,
      client.emitter,
    );
    // Pure read — take the simulated result rather than submitting a tx (#279).
    return tx.result as CircleView;
  } catch (err) {
    throw decodeContractError(err);
  }
}

/**
 * Retrieves a circle's Groth16 verification key.
 *
 * The VK is committed at circle creation and never changes, so the result is
 * cached per `(contractId, circleId)` for the lifetime of the session —
 * repeated calls for the same circle are served from the cache and perform no
 * RPC. Call {@link clearContractClientCache} to invalidate.
 *
 * Uses simulation only — no transaction is submitted, no fee is charged, and
 * no funded keypair is required.
 *
 * @param client - The Sharibo contract client.
 * @param circleId - The ID of the circle to query.
 * @returns The circle's verification key.
 */
export async function getVk(
  client: ShariboClient,
  circleId: bigint,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<ContractVerificationKey> {
  const cacheKey = `${contractIdOf(client)}:${circleId}`;
  const cached = vkCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  try {
    const tx: ContractTx = await withRetry(
      () => client.get_vk({ circle_id: circleId }),
      retryPolicy,
      client.emitter,
    );
    const vk = tx.result as ContractVerificationKey;
    vkCache.set(cacheKey, vk);
    return vk;
  } catch (err) {
    throw decodeContractError(err);
  }
}

/**
 * The subset of a circle's state the funding UI polls for: how much is in the
 * pot and which accounts have contributed so far.
 *
 * A positive `remainingLedgers` means the round is still open; zero or below
 * means it has expired and {@link expireRound} can be invoked. `expired`
 * mirrors that comparison for callers that only need the boolean.
 */
export interface CircleStatus {
  pot: bigint;
  contributors: string[];
  round: number;
  cancelled: boolean;
}

/**
 * Pure read: the funding-progress slice of a circle's on-chain state.
 *
 * Composes the cheap `get_circle_meta` and `get_contributors` reads rather
 * than the heavyweight `get_circle`, so polling never transfers the
 * verification key.
 */
export async function getCircleStatus(
  client: ShariboClient,
  circleId: CircleId,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<CircleStatus> {
  const [circle, contributors] = await Promise.all([
    getCircle(client, circleId, retryPolicy),
    getContributors(client, circleId),
  ]);
  return {
    pot: circle.pot,
    contributors,
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
    const tx: ContractTx = await withRetry(
      () => client.get_circle_count(),
      retryPolicy,
      client.emitter,
    );
    return tx.result as bigint;
  } catch (err) {
    throw decodeContractError(err);
  }
}

/** Pure read: the current round number for `circleId`. */
export async function getRound(
  client: ShariboClient,
  circleId: bigint,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<number> {
  const tx: ContractTx = await withRetry(
    () => client.get_round({ circle_id: circleId }),
    retryPolicy,
    client.emitter,
  );
  return Number(tx.result);
}

/** Pure read: the current pot balance (in token stroops) for `circleId`. */
export async function getPot(
  client: ShariboClient,
  circleId: bigint,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<bigint> {
  const tx: ContractTx = await withRetry(
    () => client.get_pot({ circle_id: circleId }),
    retryPolicy,
    client.emitter,
  );
  return BigInt(tx.result);
}

/**
 * Derive the round deadline from a circle's `round_started_ledger` and
 * `round_deadline_ledgers` fields and the current ledger sequence.
 *
 * Pure helper so both the SDK facade and the app can render "how long until
 * expiry" without an extra contract view.
 */
export async function getStatus(
  client: ShariboClient,
  circleId: bigint,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<{ round: number; pot: bigint; target: bigint; cancelled: boolean }> {
  const tx: ContractTx = await withRetry(
    () => client.get_status({ circle_id: circleId }),
    retryPolicy,
    client.emitter,
  );
  const [round, pot, target, cancelled] = tx.result as [
    bigint | number,
    bigint | string,
    bigint | string,
    boolean,
  ];
  return {
    startedLedger,
    deadlineLedgers,
    deadlineLedger,
    remainingLedgers,
    expired: remainingLedgers <= 0,
  };
}

/** Pure read: the ordered list of addresses that funded the current round. */
export async function getContributors(
  client: ShariboClient,
  circleId: bigint,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<string[]> {
  const tx: ContractTx = await withRetry(
    () => client.get_contributors({ circle_id: circleId }),
    retryPolicy,
    client.emitter,
  );
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
  circleId: CircleId,
  nullifierHash: NullifierHash,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<boolean> {
  // `has_claimed` is a pure read — don't submit or force a transaction.
  // The SDK returns the raw result for read-only contract calls, so just
  // invoke it and return the boolean directly.
  const tx: ContractTx = await withRetry(
    () =>
      client.has_claimed({
        circle_id: circleId,
        nullifier_hash: nullifierHash,
      }),
    retryPolicy,
    client.emitter,
  );
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
  args: { circleId: CircleId },
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<TxResult<void>> {
  try {
    const tx: ContractTx = await withRetry(
      () => client.cancel_circle({ circle_id: args.circleId }),
      retryPolicy,
      client.emitter,
    );
    const sent = await tx.signAndSend();
    return populateTxResult(undefined, sent, networkPassphraseFromClient(client));
  } catch (err) {
    throw decodeContractError(err);
  }
}
