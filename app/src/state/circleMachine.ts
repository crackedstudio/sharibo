import type { Keypair } from "@stellar/stellar-sdk";
import {
  ContractError,
  RpcError,
  ProvingError,
  InvalidInputError,
  xlmToStroops,
  type MerkleTree,
  type ContractProof,
  type CircleId,
  type FeeEstimate,
} from "@sharibo/client";
import { FriendbotRetryableError } from "../lib/friendbot.js";
import { config } from "../config.js";
import { checkContractDeployed } from "../lib/testnetHealth.js";
import type { ClaimStage, Member } from "../types.js";

export interface UiError {
  key: string;
  vars?: Record<string, string | number>;
}

// Which step failed. The UI uses this to scope the retry action and to
// decide whether retrying is even meaningful (a failed claim, for example,
// can reuse an already-generated proof; a failed create cannot).
export type FailureStep = "start" | "fund" | "claim";

// A modelled failure: enough context for the UI to both explain what went
// wrong and to re-run exactly the action that failed. `retry` carries the
// step's retry closure so the notification (Toaster) never has to know
// which handler to call.
export interface Failure {
  step: FailureStep;
  message: string;
  // Retryable = transient (RPC / network). When false, the failure is
  // terminal and offering a retry would be pointless (e.g. AlreadyClaimed).
  retryable: boolean;
  retry: () => void;
}

// Terminal contract / input rejections that retrying cannot resolve.
function isTerminalError(e: unknown): boolean {
  if (e instanceof InvalidInputError) return true;
  if (e instanceof ProvingError) return true;
  // Any on-chain revert is a logic error, not a transient RPC blip, so it is
  // terminal by default — with AlreadyClaimed / InvalidProof called out
  // explicitly below for message-based detection.
  if (e instanceof ContractError) return true;
  const msg = e instanceof Error ? e.message : "";
  if (/already.?claimed|invalid.?proof/i.test(msg)) return true;
  return false;
}

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) {
    return /fetch|network|timeout|abort/i.test(e.message);
  }
  const msg = e instanceof Error ? e.message : "";
  return /failed to fetch|network|timeout|econnrefused|etimedout|connection/i.test(msg);
}

// Retryable = transient (RPC, network). Everything else is treated as
// terminal, with AlreadyClaimed / InvalidProof explicitly non-retryable.
// An unrecognized error is optimistically considered retryable so a user
// facing a transient failure still gets a path forward.
function isRetryableError(e: unknown): boolean {
  if (e instanceof RpcError) return true;
  if (e instanceof FriendbotRetryableError) return true;
  if (isTerminalError(e)) return false;
  if (isNetworkError(e)) return true;
  return true;
}

// Decodes an error into a user-facing message, distinguishing the situations
// that previously collapsed into one generic string: RPC being unreachable,
// a transaction being rejected by the contract, and proof/input problems.
export function toUiError(e: unknown): UiError {
  if (e instanceof FriendbotRetryableError) {
    return { key: "error.friendbotRateLimit" };
  }
  if (e instanceof RpcError) {
    return { key: "error.rpc" };
  }
  if (e instanceof InvalidInputError) {
    return { key: "error.invalidInput", vars: { message: e.message } };
  }
  if (e instanceof ProvingError) {
    return { key: "error.proving", vars: { message: e.message } };
  }
  if (e instanceof ContractError) {
    const keys: Record<number, string> = {
      1: "error.circleNotFound",
      2: "error.roundNotFunded",
      3: "error.wrongRoundTag",
      4: "error.alreadyClaimed",
      5: "error.invalidProof",
      6: "error.roundFull",
      7: "error.overflow",
      8: "error.circleCancelled",
      9: "error.invalidFeeParams",
      10: "error.invalidCircleParams",
      11: "error.invalidRecipient",
      12: "error.roundNotExpired",
    };
    return e.code && keys[e.code]
      ? { key: keys[e.code] }
      : { key: "error.contract", vars: { message: e.message } };
  }
  if (e instanceof TypeError) {
    return { key: "error.offline" };
  }
  if (e instanceof Error) {
    return { key: "error.raw", vars: { message: e.message } };
  }
  return { key: "error.generic" };
}

// Full diagnosis used by step handlers. It first checks the two situations
// that aren't visible from the thrown error alone:
//   1. the browser is offline (navigator.onLine), and
//   2. the testnet was reset (the contract id no longer resolves, while the
//      RPC itself is healthy).
// Only then falls back to decoding the error itself. Returns the message to
// show plus whether a retry makes sense.
export async function diagnose(e: unknown): Promise<{ message: UiError; retryable: boolean }> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      message: { key: "error.offline" },
      retryable: true,
    };
  }

  try {
    const health = await checkContractDeployed(config.rpcUrl, config.contractId);
    if (!health.ok) {
      return {
        message: {
          key: "error.testnetReset",
          vars: {
            message:
              health.message ??
              "The testnet appears to have been reset and your circle no longer exists.",
          },
        },
        retryable: false,
      };
    }
  } catch {
    // The health probe itself failed — don't mask the original error.
  }

  return {
    message: toUiError(e),
    retryable: isRetryableError(e),
  };
}

// ---------------------------------------------------------------------------
// Circle flow state machine
//
// idle → creating → funding → readyToClaim → proving → claiming → claimed
//
// `failed` carries the error (and, once a circle exists, the data needed to
// retry). `claimResult` exists only on `claimed` (and on a failure that
// happened after a successful claim). The proving stage exists only on
// `proving`, so a view cannot be proving and claimed at the same time.
//
// Illegal transitions throw in development and return the current state in
// production.
// ---------------------------------------------------------------------------

/** Demo circle size. Matches the on-screen ring in App.tsx. */
const CIRCLE_SIZE = 5;

export interface CircleMember extends Member {
  freighterKey?: string;
}

export interface CircleClaimResult {
  recipient: string;
  hash: string;
  proofDurationMs: number;
  verifyTimeMs: number;
  feeCharged?: string;
  feeEstimate?: FeeEstimate;
}

/** Data that exists once a circle has been created on-chain. */
export interface CircleSnapshot {
  contributionXlm: number;
  admin: Keypair;
  members: CircleMember[];
  tree: MerkleTree;
  circleId: CircleId;
  round: number;
  pot: bigint;
  claimantIndex: number;
  feeBps: number;
  feeRecipient: string;
  onChainContributors: string[];
  cancelled: boolean;
  stepTimings: Record<string, number>;
  feeEstimate: FeeEstimate | null;
}

/** Circle data retained on `failed`, including claim fields when a claim already landed. */
export interface FailedCircle extends CircleSnapshot {
  proof: ContractProof | null;
  nullifierHash: bigint | null;
  provingElapsedMs: number | null;
  claimResult: CircleClaimResult | null;
  nullifierClaimed: boolean;
  rejection: string | null;
}

export type CircleStatus =
  "idle" | "creating" | "funding" | "readyToClaim" | "proving" | "claiming" | "claimed" | "failed";

interface IdleState {
  status: "idle";
  contributionXlm: number;
  previousCircleId: CircleId | null;
}

interface CreatingState {
  status: "creating";
  contributionXlm: number;
  previousCircleId: CircleId | null;
  busy: string;
}

interface FundingState extends CircleSnapshot {
  status: "funding";
  previousCircleId: CircleId | null;
  busy: string | null;
}

interface ReadyToClaimState extends CircleSnapshot {
  status: "readyToClaim";
  previousCircleId: CircleId | null;
  busy: string | null;
}

interface ProvingState extends CircleSnapshot {
  status: "proving";
  previousCircleId: CircleId | null;
  busy: string;
  claimStage: Exclude<ClaimStage, "submitting">;
  proveElapsedSeconds: number;
}

interface ClaimingState extends CircleSnapshot {
  status: "claiming";
  previousCircleId: CircleId | null;
  busy: string;
  claimStage: "submitting";
  proveElapsedSeconds: number;
  proof: ContractProof;
  nullifierHash: bigint;
  provingElapsedMs: number | null;
}

interface ClaimedState extends CircleSnapshot {
  status: "claimed";
  previousCircleId: CircleId | null;
  busy: string | null;
  proof: ContractProof;
  nullifierHash: bigint;
  provingElapsedMs: number | null;
  claimResult: CircleClaimResult;
  nullifierClaimed: boolean;
  rejection: string | null;
}

interface FailedState {
  status: "failed";
  error: string;
  failedFrom: Exclude<CircleStatus, "failed">;
  contributionXlm: number;
  previousCircleId: CircleId | null;
  circle: FailedCircle | null;
}

export type CircleState =
  | IdleState
  | CreatingState
  | FundingState
  | ReadyToClaimState
  | ProvingState
  | ClaimingState
  | ClaimedState
  | FailedState;

export type CircleAction =
  | { type: "start"; busy: string }
  | { type: "setBusy"; busy: string; clearRejection?: boolean }
  | { type: "created"; circle: CircleSnapshot }
  | {
      type: "patchMember";
      index: number;
      pending?: boolean;
      fundHash?: string;
      freighterKey?: string;
    }
  | {
      type: "syncChain";
      pot: bigint;
      round: number;
      onChainContributors?: string[];
      cancelled?: boolean;
      feeBps?: number;
      feeRecipient?: string;
    }
  | { type: "selectClaimant"; index: number }
  | { type: "beginProve"; busy: string }
  | { type: "proveStage"; stage: Exclude<ClaimStage, "submitting">; proveElapsedSeconds?: number }
  | { type: "proveTick" }
  | {
      type: "beginClaim";
      proof: ContractProof;
      nullifierHash: bigint;
      provingElapsedMs: number | null;
    }
  | { type: "claimed"; claimResult: CircleClaimResult; nullifierClaimed: boolean }
  | { type: "recordRejection"; rejection: string }
  | { type: "clearBusy" }
  | { type: "fail"; error: string }
  | { type: "retry" }
  | { type: "reset"; previousCircleId: CircleId | null }
  | {
      type: "resume";
      circle: CircleSnapshot;
      proof: ContractProof | null;
      nullifierHash: bigint | null;
      claimResult: CircleClaimResult | null;
      rejection: string | null;
      nullifierClaimed: boolean;
      provingElapsedMs: number | null;
    }
  | { type: "setFeeEstimate"; feeEstimate: FeeEstimate | null }
  | { type: "setEligibility"; ineligible: boolean[]; reason: string };

export const initialState: CircleState = {
  status: "idle",
  contributionXlm: 10,
  previousCircleId: null,
};

export function isCircleFullyFunded(pot: bigint, contributionXlm: number): boolean {
  return pot === xlmToStroops(contributionXlm) * BigInt(CIRCLE_SIZE);
}

/** Flat view of a circle state. Proving and claimed cannot both be set. */
export interface CircleView {
  screen: "landing" | "circle";
  circlePhase: "idle" | "loading" | "ready" | "error";
  busy: string | null;
  error: string | null;
  contributionXlm: number;
  admin: Keypair | null;
  members: CircleMember[];
  tree: MerkleTree | null;
  circleId: CircleId | null;
  round: number;
  pot: bigint;
  feeBps: number;
  feeRecipient: string;
  onChainContributors: string[];
  cancelled: boolean;
  claimantIndex: number;
  proof: ContractProof | null;
  nullifierHash: bigint | null;
  claimResult: CircleClaimResult | null;
  isProving: boolean;
  provingElapsedMs: number | null;
  nullifierClaimed: boolean;
  rejection: string | null;
  claimStage: ClaimStage | null;
  proveElapsedSeconds: number;
  stepTimings: Record<string, number>;
  previousCircleId: CircleId | null;
  feeEstimate: FeeEstimate | null;
}

export function selectCircle(state: CircleState): CircleView {
  const base: CircleView = {
    screen: "landing",
    circlePhase: "idle",
    busy: null,
    error: null,
    contributionXlm: state.status === "failed" ? state.contributionXlm : contributionFrom(state),
    admin: null,
    members: [],
    tree: null,
    circleId: null,
    round: 0,
    pot: 0n,
    feeBps: 0,
    feeRecipient: "",
    onChainContributors: [],
    cancelled: false,
    claimantIndex: 0,
    proof: null,
    nullifierHash: null,
    claimResult: null,
    isProving: false,
    provingElapsedMs: null,
    nullifierClaimed: false,
    rejection: null,
    claimStage: null,
    proveElapsedSeconds: 0,
    stepTimings: {},
    previousCircleId: state.previousCircleId,
    feeEstimate: null,
  };

  switch (state.status) {
    case "idle":
      return { ...base, contributionXlm: state.contributionXlm };
    case "creating":
      return {
        ...base,
        circlePhase: "loading",
        busy: state.busy,
        contributionXlm: state.contributionXlm,
      };
    case "failed": {
      if (!state.circle) {
        return {
          ...base,
          circlePhase: "error",
          error: state.error,
          contributionXlm: state.contributionXlm,
        };
      }
      return {
        ...fillFromSnapshot(base, state.circle),
        screen: "circle",
        circlePhase: "error",
        error: state.error,
        proof: state.circle.proof,
        nullifierHash: state.circle.nullifierHash,
        claimResult: state.circle.claimResult,
        provingElapsedMs: state.circle.provingElapsedMs,
        nullifierClaimed: state.circle.claimResult ? state.circle.nullifierClaimed : false,
        rejection: state.circle.claimResult ? state.circle.rejection : null,
        isProving: false,
        claimStage: null,
      };
    }
    case "funding":
    case "readyToClaim":
      return {
        ...fillFromSnapshot(base, state),
        screen: "circle",
        circlePhase: "ready",
        busy: state.busy,
      };
    case "proving":
      return {
        ...fillFromSnapshot(base, state),
        screen: "circle",
        circlePhase: "ready",
        busy: state.busy,
        claimStage: state.claimStage,
        proveElapsedSeconds: state.proveElapsedSeconds,
        isProving: state.claimStage === "proving",
      };
    case "claiming":
      return {
        ...fillFromSnapshot(base, state),
        screen: "circle",
        circlePhase: "ready",
        busy: state.busy,
        claimStage: "submitting",
        proveElapsedSeconds: state.proveElapsedSeconds,
        proof: state.proof,
        nullifierHash: state.nullifierHash,
        provingElapsedMs: state.provingElapsedMs,
      };
    case "claimed":
      return {
        ...fillFromSnapshot(base, state),
        screen: "circle",
        circlePhase: "ready",
        busy: state.busy,
        proof: state.proof,
        nullifierHash: state.nullifierHash,
        provingElapsedMs: state.provingElapsedMs,
        claimResult: state.claimResult,
        nullifierClaimed: state.nullifierClaimed,
        rejection: state.rejection,
        isProving: false,
        claimStage: null,
      };
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function contributionFrom(state: CircleState): number {
  if (state.status === "idle" || state.status === "creating" || state.status === "failed") {
    return state.contributionXlm;
  }
  return state.contributionXlm;
}

function fillFromSnapshot(base: CircleView, snapshot: CircleSnapshot): CircleView {
  return {
    ...base,
    contributionXlm: snapshot.contributionXlm,
    admin: snapshot.admin,
    members: snapshot.members,
    tree: snapshot.tree,
    circleId: snapshot.circleId,
    round: snapshot.round,
    pot: snapshot.pot,
    feeBps: snapshot.feeBps,
    feeRecipient: snapshot.feeRecipient,
    onChainContributors: snapshot.onChainContributors,
    cancelled: snapshot.cancelled,
    claimantIndex: snapshot.claimantIndex,
    stepTimings: snapshot.stepTimings,
    feeEstimate: snapshot.feeEstimate,
    previousCircleId: base.previousCircleId,
  };
}

function reject(state: CircleState, action: CircleAction, dev: boolean): CircleState {
  if (dev) {
    throw new Error(`Illegal circle transition: ${action.type} from ${state.status}`);
  }
  return state;
}

function snapshotOf(state: CircleSnapshot): CircleSnapshot {
  return {
    contributionXlm: state.contributionXlm,
    admin: state.admin,
    members: state.members,
    tree: state.tree,
    circleId: state.circleId,
    round: state.round,
    pot: state.pot,
    claimantIndex: state.claimantIndex,
    feeBps: state.feeBps,
    feeRecipient: state.feeRecipient,
    onChainContributors: state.onChainContributors,
    cancelled: state.cancelled,
    stepTimings: state.stepTimings,
    feeEstimate: state.feeEstimate,
  };
}

function clearPending(members: CircleMember[]): CircleMember[] {
  return members.map((member) => (member.pending ? { ...member, pending: false } : member));
}

function applyContributors(members: CircleMember[], contributors: string[]): CircleMember[] {
  return members.map((member) => {
    const key = member.keypair.publicKey();
    const funded =
      contributors.includes(key) ||
      Boolean(member.freighterKey && contributors.includes(member.freighterKey));
    return { ...member, funded, pending: false };
  });
}

function emptyClaimFields(): Pick<
  FailedCircle,
  "proof" | "nullifierHash" | "provingElapsedMs" | "claimResult" | "nullifierClaimed" | "rejection"
> {
  return {
    proof: null,
    nullifierHash: null,
    provingElapsedMs: null,
    claimResult: null,
    nullifierClaimed: false,
    rejection: null,
  };
}

function toFailedCircle(
  state: Exclude<CircleState, IdleState | CreatingState | FailedState>,
): FailedCircle {
  const snapshot = snapshotOf({ ...state, members: clearPending(state.members) });
  if (state.status === "claiming") {
    return {
      ...snapshot,
      ...emptyClaimFields(),
      proof: state.proof,
      nullifierHash: state.nullifierHash,
      provingElapsedMs: state.provingElapsedMs,
    };
  }
  if (state.status === "claimed") {
    return {
      ...snapshot,
      proof: state.proof,
      nullifierHash: state.nullifierHash,
      provingElapsedMs: state.provingElapsedMs,
      claimResult: state.claimResult,
      nullifierClaimed: state.nullifierClaimed,
      rejection: state.rejection,
    };
  }
  return { ...snapshot, ...emptyClaimFields() };
}

function busyLive<
  S extends FundingState | ReadyToClaimState | ProvingState | ClaimingState | ClaimedState,
>(state: S, busy: S["busy"]): S {
  return { ...state, busy };
}

function restoreFailed(
  state: FailedState,
  busy: string | null,
  clearRejection: boolean,
): CircleState | null {
  if (!state.circle) return null;
  const circle = state.circle;
  const snapshot = snapshotOf(circle);
  const previousCircleId = state.previousCircleId;

  if (state.failedFrom === "claimed") {
    if (!circle.claimResult || !circle.proof || circle.nullifierHash === null) return null;
    return {
      ...snapshot,
      previousCircleId,
      status: "claimed",
      busy,
      proof: circle.proof,
      nullifierHash: circle.nullifierHash,
      provingElapsedMs: circle.provingElapsedMs,
      claimResult: circle.claimResult,
      nullifierClaimed: circle.nullifierClaimed,
      rejection: clearRejection ? null : circle.rejection,
    };
  }

  // A failed create has no circle. Anything else returns to funding, or to
  // readyToClaim when the pot is still full — never back into proving.
  if (state.failedFrom === "idle" || state.failedFrom === "creating") return null;
  if (!isCircleFullyFunded(snapshot.pot, snapshot.contributionXlm)) {
    return { ...snapshot, previousCircleId, status: "funding", busy };
  }
  return { ...snapshot, previousCircleId, status: "readyToClaim", busy };
}

function canSelectClaimant(state: CircleState): boolean {
  if (state.status === "funding" || state.status === "readyToClaim") return true;
  return state.status === "failed" && state.circle !== null && state.circle.claimResult === null;
}

function canBeginProve(state: CircleState): boolean {
  if (state.status === "readyToClaim") return true;
  return (
    state.status === "failed" &&
    state.circle !== null &&
    state.circle.claimResult === null &&
    isCircleFullyFunded(state.circle.pot, state.circle.contributionXlm)
  );
}

function withMembers(state: CircleState, members: CircleMember[]): CircleState | null {
  if (state.status === "failed") {
    if (!state.circle) return null;
    return { ...state, circle: { ...state.circle, members } };
  }
  if (
    state.status === "funding" ||
    state.status === "readyToClaim" ||
    state.status === "proving" ||
    state.status === "claiming" ||
    state.status === "claimed"
  ) {
    return { ...state, members };
  }
  return null;
}

function reduceCircle(state: CircleState, action: CircleAction, dev: boolean): CircleState {
  switch (action.type) {
    case "start": {
      if (state.status === "idle" || (state.status === "failed" && state.circle === null)) {
        return {
          status: "creating",
          contributionXlm: state.contributionXlm,
          previousCircleId: state.previousCircleId,
          busy: action.busy,
        };
      }
      return reject(state, action, dev);
    }

    case "setBusy": {
      if (state.status === "failed") {
        const restored = restoreFailed(state, action.busy, action.clearRejection === true);
        return restored ?? reject(state, action, dev);
      }
      if (state.status === "creating") {
        return { ...state, busy: action.busy };
      }
      if (
        state.status === "funding" ||
        state.status === "readyToClaim" ||
        state.status === "claimed"
      ) {
        const next = busyLive(state, action.busy);
        if (next.status === "claimed" && action.clearRejection) {
          return { ...next, rejection: null };
        }
        return next;
      }
      if (state.status === "proving" || state.status === "claiming") {
        return busyLive(state, action.busy);
      }
      return reject(state, action, dev);
    }

    case "created": {
      if (state.status !== "creating") return reject(state, action, dev);
      return {
        ...action.circle,
        previousCircleId: state.previousCircleId,
        status: "funding",
        busy: null,
      };
    }

    case "patchMember": {
      const members = membersOf(state);
      if (!members || action.index < 0 || action.index >= members.length) {
        return reject(state, action, dev);
      }
      const nextMembers = members.map((member, index) => {
        if (index !== action.index) return member;
        return {
          ...member,
          ...(action.pending !== undefined ? { pending: action.pending } : {}),
          ...(action.fundHash !== undefined ? { fundHash: action.fundHash } : {}),
          ...(action.freighterKey !== undefined ? { freighterKey: action.freighterKey } : {}),
        };
      });
      return withMembers(state, nextMembers) ?? reject(state, action, dev);
    }

    case "syncChain":
      return reduceSync(state, action, dev);

    case "selectClaimant": {
      if (!canSelectClaimant(state)) return reject(state, action, dev);
      if (state.status === "failed" && state.circle) {
        return { ...state, circle: { ...state.circle, claimantIndex: action.index } };
      }
      if (state.status === "funding" || state.status === "readyToClaim") {
        return { ...state, claimantIndex: action.index };
      }
      return reject(state, action, dev);
    }

    case "beginProve": {
      if (!canBeginProve(state)) return reject(state, action, dev);
      const source =
        state.status === "readyToClaim" ? state : state.status === "failed" ? state.circle : null;
      if (!source) return reject(state, action, dev);
      const previousCircleId = state.previousCircleId;
      return {
        ...snapshotOf(source),
        previousCircleId,
        status: "proving",
        busy: action.busy,
        claimStage: "artifacts",
        proveElapsedSeconds: 0,
      };
    }

    case "proveStage": {
      if (state.status !== "proving") return reject(state, action, dev);
      return {
        ...state,
        claimStage: action.stage,
        proveElapsedSeconds: action.proveElapsedSeconds ?? state.proveElapsedSeconds,
      };
    }

    case "proveTick": {
      if (state.status !== "proving") return reject(state, action, dev);
      return { ...state, proveElapsedSeconds: state.proveElapsedSeconds + 1 };
    }

    case "beginClaim": {
      if (state.status !== "proving") return reject(state, action, dev);
      return {
        ...snapshotOf(state),
        previousCircleId: state.previousCircleId,
        status: "claiming",
        busy: state.busy,
        claimStage: "submitting",
        proveElapsedSeconds: state.proveElapsedSeconds,
        proof: action.proof,
        nullifierHash: action.nullifierHash,
        provingElapsedMs: action.provingElapsedMs,
      };
    }

    case "claimed": {
      if (state.status !== "claiming") return reject(state, action, dev);
      return {
        ...snapshotOf(state),
        previousCircleId: state.previousCircleId,
        status: "claimed",
        busy: state.busy,
        proof: state.proof,
        nullifierHash: state.nullifierHash,
        provingElapsedMs: state.provingElapsedMs,
        claimResult: action.claimResult,
        nullifierClaimed: action.nullifierClaimed,
        rejection: null,
      };
    }

    case "recordRejection": {
      if (state.status !== "claimed") return reject(state, action, dev);
      return { ...state, rejection: action.rejection };
    }

    case "clearBusy": {
      if (
        state.status === "funding" ||
        state.status === "readyToClaim" ||
        state.status === "claimed"
      ) {
        return busyLive(state, null);
      }
      if (state.status === "proving" || state.status === "claiming") {
        const snapshot = snapshotOf(state);
        const previousCircleId = state.previousCircleId;
        if (!isCircleFullyFunded(snapshot.pot, snapshot.contributionXlm)) {
          return { ...snapshot, previousCircleId, status: "funding", busy: null };
        }
        return { ...snapshot, previousCircleId, status: "readyToClaim", busy: null };
      }
      return reject(state, action, dev);
    }

    case "fail": {
      if (state.status === "creating") {
        return {
          status: "failed",
          error: action.error,
          failedFrom: "creating",
          contributionXlm: state.contributionXlm,
          previousCircleId: state.previousCircleId,
          circle: null,
        };
      }
      if (
        state.status === "funding" ||
        state.status === "readyToClaim" ||
        state.status === "proving" ||
        state.status === "claiming" ||
        state.status === "claimed"
      ) {
        return {
          status: "failed",
          error: action.error,
          failedFrom: state.status,
          contributionXlm: state.contributionXlm,
          previousCircleId: state.previousCircleId,
          circle: toFailedCircle(state),
        };
      }
      return reject(state, action, dev);
    }

    case "retry": {
      if (state.status !== "failed") return reject(state, action, dev);
      if (!state.circle) {
        return {
          status: "idle",
          contributionXlm: state.contributionXlm,
          previousCircleId: state.previousCircleId,
        };
      }
      return restoreFailed(state, null, false) ?? reject(state, action, dev);
    }

    case "reset":
      return {
        status: "idle",
        contributionXlm: 10,
        previousCircleId: action.previousCircleId,
      };

    case "resume": {
      if (state.status !== "idle") return reject(state, action, dev);
      return resumeInto(state, action);
    }

    case "setFeeEstimate": {
      if (state.status !== "proving" && state.status !== "claiming") {
        return reject(state, action, dev);
      }
      return { ...state, feeEstimate: action.feeEstimate };
    }

    case "setEligibility": {
      if (state.status !== "readyToClaim") return reject(state, action, dev);
      if (action.ineligible.length !== state.members.length) return reject(state, action, dev);
      return {
        ...state,
        members: state.members.map((member, index) => ({
          ...member,
          ineligible: action.ineligible[index],
          ineligibleReason: action.ineligible[index] ? action.reason : undefined,
        })),
      };
    }

    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

function membersOf(state: CircleState): CircleMember[] | null {
  if (state.status === "failed") return state.circle?.members ?? null;
  if (
    state.status === "funding" ||
    state.status === "readyToClaim" ||
    state.status === "proving" ||
    state.status === "claiming" ||
    state.status === "claimed"
  ) {
    return state.members;
  }
  return null;
}

function reduceSync(
  state: CircleState,
  action: Extract<CircleAction, { type: "syncChain" }>,
  dev: boolean,
): CircleState {
  if (state.status === "failed") {
    if (!state.circle) return reject(state, action, dev);
    if (action.round < state.circle.round) return reject(state, action, dev);
    return {
      ...state,
      circle: {
        ...state.circle,
        ...syncedSnapshot(state.circle, action),
      },
    };
  }

  if (
    state.status !== "funding" &&
    state.status !== "readyToClaim" &&
    state.status !== "proving" &&
    state.status !== "claiming" &&
    state.status !== "claimed"
  ) {
    return reject(state, action, dev);
  }

  if (action.round < state.round) return reject(state, action, dev);

  const synced = syncedSnapshot(state, action);

  if (state.status === "funding" || state.status === "readyToClaim") {
    const status: "funding" | "readyToClaim" = isCircleFullyFunded(
      synced.pot,
      synced.contributionXlm,
    )
      ? "readyToClaim"
      : "funding";
    return { ...state, ...synced, status };
  }

  return { ...state, ...synced };
}

function syncedSnapshot(
  snapshot: CircleSnapshot,
  action: Extract<CircleAction, { type: "syncChain" }>,
): CircleSnapshot {
  return {
    ...snapshotOf(snapshot),
    pot: action.pot,
    round: action.round,
    members: action.onChainContributors
      ? applyContributors(snapshot.members, action.onChainContributors)
      : snapshot.members,
    onChainContributors: action.onChainContributors ?? snapshot.onChainContributors,
    cancelled: action.cancelled ?? snapshot.cancelled,
    feeBps: action.feeBps ?? snapshot.feeBps,
    feeRecipient: action.feeRecipient ?? snapshot.feeRecipient,
  };
}

function resumeInto(
  state: IdleState,
  action: Extract<CircleAction, { type: "resume" }>,
): CircleState {
  const previousCircleId = state.previousCircleId;
  if (action.claimResult && action.proof && action.nullifierHash !== null) {
    return {
      ...action.circle,
      previousCircleId,
      status: "claimed",
      busy: null,
      proof: action.proof,
      nullifierHash: action.nullifierHash,
      provingElapsedMs: action.provingElapsedMs,
      claimResult: action.claimResult,
      nullifierClaimed: action.nullifierClaimed,
      rejection: action.rejection,
    };
  }
  if (isCircleFullyFunded(action.circle.pot, action.circle.contributionXlm)) {
    return { ...action.circle, previousCircleId, status: "readyToClaim", busy: null };
  }
  return { ...action.circle, previousCircleId, status: "funding", busy: null };
}

/** Build a reducer. `dev` defaults to Vite's development mode. */
export function createCircleReducer(dev: boolean = !import.meta.env.PROD) {
  return function circleReducer(state: CircleState, action: CircleAction): CircleState {
    return reduceCircle(state, action, dev);
  };
}

export const circleReducer = createCircleReducer();
