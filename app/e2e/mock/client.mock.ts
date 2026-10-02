/**
 * Mock-RPC layer for the browser e2e suite (default mode).
 *
 * The Vite config in ../vite.mock.config.ts aliases `@sharibo/client` to this
 * file and `@sharibo/client-real` to the real built SDK. Everything the app
 * imports is the real SDK — identity generation, the Merkle tree, Groth16
 * proving (real wasm + zkey, in the browser), local proof verification —
 * except the handful of functions that would talk to Soroban RPC. Those are
 * replaced below with an in-memory chain.
 *
 * Local exports shadow `export *`, so overriding a name here is enough.
 *
 * What the fake chain enforces (so a broken UI/proof path still fails):
 *   - a circle must be fully funded before it can be claimed
 *   - the external nullifier must match this circle + round
 *   - the proof must have the wire-format lengths (G1 96 B, G2 192 B, G1 96 B)
 *   - a nullifier can only be used once
 *
 * What it does NOT do: verify the pairing on-chain. The app's own
 * `verifyProofLocally` still runs against the real verification key before
 * the claim is submitted, so a bad proof is still caught in the browser.
 */
import {
  AlreadyClaimedError,
  CircleCancelledError,
  CircleNotFoundError,
  ContractError,
  InvalidProofError,
  RoundFullError,
  RoundNotFundedError,
  WrongRoundTagError,
  computeExternalNullifier,
  type CircleView,
  type ContractProof,
  type ContractVerificationKey,
  type TxResult,
} from "@sharibo/client-real";

export * from "@sharibo/client-real";

interface MockCircle {
  admin: string;
  token: string;
  root: bigint;
  contribution: bigint;
  size: number;
  vk: ContractVerificationKey;
  feeBps: number;
  feeRecipient: string;
  round: number;
  contributors: string[];
  /** Every address that ever funded, kept after a claim clears `contributors`. */
  fundedBy: string[];
  cancelled: boolean;
  nullifiers: Set<string>;
  claims: { recipient: string; nullifierHash: string; round: number }[];
}

const circles: MockCircle[] = [];
let txCounter = 0;

/** Small delay so busy/pending UI states are actually rendered, like a real RPC round-trip. */
const roundTrip = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

function fakeHash(): string {
  txCounter += 1;
  return txCounter.toString(16).padStart(64, "0");
}

function txResult<T>(result: T): TxResult<T> {
  return { result, hash: fakeHash(), ledger: 1000 + txCounter, feeCharged: "100" };
}

function lookup(circleId: bigint): MockCircle {
  const circle = circles[Number(circleId)];
  if (!circle) throw new CircleNotFoundError(`circle ${circleId} does not exist`);
  return circle;
}

function signerAddress(signer: unknown): string {
  const s = signer as { publicKey: string | (() => string) };
  return typeof s.publicKey === "function" ? s.publicKey() : s.publicKey;
}

export async function connect(_config: unknown, signer: unknown): Promise<unknown> {
  return { mock: true, publicKey: signerAddress(signer) };
}

// Takes no parameters: the real one's config argument is irrelevant to the fake chain.
export async function connectReadOnly(): Promise<unknown> {
  return { mock: true };
}

export async function createCircle(
  _client: unknown,
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
): Promise<TxResult<bigint>> {
  await roundTrip();
  circles.push({
    admin: args.admin,
    token: args.token,
    root: args.root,
    contribution: args.contribution,
    size: args.size,
    vk: args.vk,
    feeBps: args.feeBps,
    feeRecipient: args.feeRecipient,
    round: 0,
    contributors: [],
    fundedBy: [],
    cancelled: false,
    nullifiers: new Set(),
    claims: [],
  });
  return txResult(BigInt(circles.length - 1));
}

export async function fund(
  _client: unknown,
  args: { circleId: bigint; from: string },
): Promise<TxResult<void>> {
  await roundTrip();
  const circle = lookup(args.circleId);
  if (circle.cancelled) throw new CircleCancelledError("circle is cancelled");
  if (circle.contributors.length >= circle.size) throw new RoundFullError("round is already full");
  if (circle.contributors.includes(args.from)) {
    throw new ContractError("this address already funded the current round", 9);
  }
  circle.contributors.push(args.from);
  if (!circle.fundedBy.includes(args.from)) circle.fundedBy.push(args.from);
  return txResult(undefined);
}

export async function getCircle(_client: unknown, circleId: bigint): Promise<CircleView> {
  await roundTrip();
  const c = lookup(circleId);
  return {
    admin: c.admin,
    token: c.token,
    root: c.root,
    contribution: c.contribution,
    size: c.size,
    round: c.round,
    pot: c.contribution * BigInt(c.contributors.length),
    vk: c.vk,
    contributors: [...c.contributors],
    cancelled: c.cancelled,
    fee_bps: c.feeBps,
    fee_recipient: c.feeRecipient,
  };
}

export async function hasClaimed(
  _client: unknown,
  circleId: bigint,
  nullifierHash: bigint,
): Promise<boolean> {
  await roundTrip();
  return lookup(circleId).nullifiers.has(nullifierHash.toString());
}

export async function claim(
  _client: unknown,
  args: {
    circleId: bigint;
    recipient: string;
    nullifierHash: bigint;
    externalNullifier: bigint;
    proof: ContractProof;
  },
): Promise<TxResult<void>> {
  await roundTrip();
  const circle = lookup(args.circleId);
  if (circle.cancelled) throw new CircleCancelledError("circle is cancelled");
  if (circle.contributors.length < circle.size) {
    throw new RoundNotFundedError("round is not fully funded");
  }

  const expected = await computeExternalNullifier(args.circleId, BigInt(circle.round));
  if (args.externalNullifier !== expected) {
    throw new WrongRoundTagError("external nullifier does not match this circle and round");
  }

  const { a, b, c } = args.proof;
  if (a?.length !== 96 || b?.length !== 192 || c?.length !== 96) {
    throw new InvalidProofError("proof has the wrong wire-format lengths");
  }

  const key = args.nullifierHash.toString();
  if (circle.nullifiers.has(key)) {
    throw new AlreadyClaimedError("nullifier already used in this circle");
  }

  circle.nullifiers.add(key);
  circle.claims.push({ recipient: args.recipient, nullifierHash: key, round: circle.round });
  // Pot pays out and the next round opens.
  circle.contributors = [];
  circle.round += 1;
  return txResult(undefined);
}

export async function cancelCircle(
  _client: unknown,
  args: { circleId: bigint },
): Promise<TxResult<void>> {
  await roundTrip();
  const circle = lookup(args.circleId);
  circle.cancelled = true;
  circle.contributors = [];
  return txResult(undefined);
}

/** Serializable view of the fake chain, read by the test via `page.evaluate`. */
export interface MockChainSnapshot {
  circles: {
    admin: string;
    fundedBy: string[];
    claims: { recipient: string; nullifierHash: string; round: number }[];
  }[];
}

declare global {
  interface Window {
    __shariboMockChain?: { snapshot(): MockChainSnapshot };
  }
}

// Presence of this hook is how the test proves the mock layer is really active.
window.__shariboMockChain = {
  snapshot: () => ({
    circles: circles.map((c) => ({
      admin: c.admin,
      fundedBy: [...c.fundedBy],
      claims: c.claims.map((x) => ({ ...x })),
    })),
  }),
};
