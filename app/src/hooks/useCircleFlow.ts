import { useCallback, useEffect, useRef, useState } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import {
  getAddress,
  getNetworkDetails,
  isAllowed,
  isConnected,
  requestAccess,
  signTransaction as freighterSignTx,
} from "@stellar/freighter-api";
import {
  AlreadyClaimedError,
  CircleCancelledError,
  CircleNotFoundError,
  ContractError,
  InvalidInputError,
  InvalidProofError,
  MerkleTree,
  OverflowError,
  ProvingError,
  RoundFullError,
  RoundNotFundedError,
  RpcError,
  TREE_LEVELS,
  WrongRoundTagError,
  describeError,
  makeCircleId,
  xlmToStroops,
  type CircleId,
  type ContractProof,
  type Identity,
  type NullifierHash,
} from "@sharibo/client";
import { config } from "../config.js";
import {
  friendbotFund,
  friendbotFundMany,
  FriendbotRetryableError,
  type FriendbotFundResult,
} from "../lib/friendbot.js";
import type { Member, ClaimResult } from "../types.js";

/** Where the circle view is in its on-chain load cycle, so the UI can show
 *  skeletons instead of an empty ring while the first read is in flight. */
export type CirclePhase = "idle" | "loading" | "ready" | "error";

export interface SavedDemoState {
  contributionXlm: number;
  adminSecret: string;
  members: Array<{
    secret: string;
    identity: {
      identityNullifier: bigint;
      identitySecret: bigint;
      identityTrapdoor?: bigint;
      commitment: bigint;
    };
    fundHash?: string;
    ineligible?: boolean;
  }>;
  circleId: CircleId | bigint | string | number;
  round: number;
  claimantIndex: number;
  proof: ContractProof | null;
  nullifierHash: bigint | null;
  claimResult: ClaimResult | null;
  rejection: string | null;
}

export interface UseCircleFlowOptions {
  onEvent?: OnEventFn;
  claimStage?: ClaimStage | null;
  setClaimStage?: (stage: ClaimStage) => void;
  resetClaimStage?: () => void;
  clearEvents?: () => void;
  t?: (key: string, vars?: Record<string, string | number>) => string;
}

const BIGINT_MARKER = "BIGINT::";
function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return BIGINT_MARKER + value.toString();
  return value;
}
function reviver(_key: string, value: unknown): unknown {
  if (typeof value === "string" && value.startsWith(BIGINT_MARKER)) {
    return BigInt(value.slice(BIGINT_MARKER.length));
  }
  return value;
}

// `config` is an empty cast when validation failed; the app gates on
// `configError` before any of these calls run.
const NETWORK = {
  contractId: config?.contractId ?? "",
  rpcUrl: config?.rpcUrl ?? "",
  networkPassphrase: config?.networkPassphrase ?? "",
};
const TOKEN = config?.testTokenContractId ?? "";
const LEVELS = TREE_LEVELS;
const CIRCLE_SIZE = 5;

/** Where the circle view is in its on-chain load cycle, so the UI can show
 *  skeletons instead of an empty ring while the first read is in flight. */
export type CirclePhase = "idle" | "loading" | "ready" | "error";

function toUiError(
  error: unknown,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (error instanceof FriendbotRetryableError) {
    return FRIEND_BOT_RATE_LIMIT_MESSAGE;
  }

  if (error instanceof AlreadyClaimedError) {
    return "This proof has already been claimed in this circle. Try the next round.";
  }
  if (error instanceof InvalidProofError) {
    return "The zero-knowledge proof is invalid. Please regenerate and try again.";
  }
  if (error instanceof RoundNotFundedError) {
    return "The circle is not fully funded yet. All members must contribute first.";
  }
  if (error instanceof WrongRoundTagError) {
    return "Proof is bound to a different round. Regenerate the proof for the current round.";
  }
  if (error instanceof CircleNotFoundError) {
    return "Circle not found on-chain. It may have been cancelled or never created.";
  }
  if (error instanceof RoundFullError) {
    return "This round is already fully funded. No more contributions are accepted.";
  }
  if (error instanceof OverflowError) {
    return "Contribution amount or circle size caused an arithmetic overflow.";
  }
  if (error instanceof CircleCancelledError) {
    return "This circle has been cancelled. Start a new one.";
  }

  if (error instanceof ContractError) {
    return error.message;
  }
  if (error instanceof RpcError) {
    return "Network error — please check your connection and retry.";
  }
  if (error instanceof ProvingError) {
    return "Proof generation failed. Please try again.";
  }
  if (error instanceof InvalidInputError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return t("error.generic");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof FriendbotRetryableError) {
    return FRIEND_BOT_RATE_LIMIT_MESSAGE;
  }
  return describeError(error);
}

// All the state and on-chain calls behind a single demo run. Kept as one hook
// because every step depends on state written by the previous one — App.tsx
// only composes the resulting state and callbacks into screens.
export function useCircleFlow() {
  const { t } = useI18n();
  const [screen, setScreen] = useState<"landing" | "circle">("landing");
  const [circlePhase, setCirclePhase] = useState<CirclePhase>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setEvents] = useState<unknown[]>([]);

  const [contributionXlm, setContributionXlm] = useState(10);
  const [admin, setAdmin] = useState<Keypair | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tree, setTree] = useState<MerkleTree | null>(null);
  const [circleId, setCircleId] = useState<CircleId | null>(null);
  const [hasFreighter, setHasFreighter] = useState(false);

  useEffect(() => {
    isConnected()
      .then((res) => setHasFreighter(res.isConnected))
      .catch(() => setHasFreighter(false));
  }, []);

  const [round, setRound] = useState(0);
  const [pot, setPot] = useState(0n);
  const [feeBps, setFeeBps] = useState(0);
  const [feeRecipient, setFeeRecipient] = useState("");
  const [onChainContributors, setOnChainContributors] = useState<string[]>([]);
  const [cancelled, setCancelled] = useState(false);
  const [claimantIndex, setClaimantIndex] = useState(0);
  const [proof, setProof] = useState<ContractProof | null>(null);
  const [nullifierHash, setNullifierHash] = useState<NullifierHash | null>(null);
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);
  const [isProving, setIsProving] = useState(false);
  const [, setProvingElapsedMs] = useState<number | null>(null);
  const [nullifierClaimed, setNullifierClaimed] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const [claimStage, setClaimStage] = useState<ClaimStage | null>(null);
  const [proveElapsedSeconds, setProveElapsedSeconds] = useState(0);
  const [stepTimings, setStepTimings] = useState<Record<string, number>>({});
  const [previousCircleId, setPreviousCircleId] = useState<CircleId | null>(null);
  const [resumePrompt, setResumePrompt] = useState<ResumeState | null>(null);
  const [prevCircle] = useState<{ id: string; explorerUrl: string } | null>(null);

  useEffect(() => {
    const saved = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("sharibo_demo_state") : null;
    if (saved) {
      try {
        const parsed = JSON.parse(saved, reviver);
        if (parsed && parsed.circleId) {
          setResumePrompt(parsed);
        }
      } catch {
        sessionStorage.removeItem("sharibo_demo_state");
      }
    }
  }, []);

  const contribution = xlmToStroops(contributionXlm);
  const claimAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      claimAbortRef.current?.abort();
    };
  }, []);

  const fundedCount = members.filter((m) => m.funded).length;
  const fullyFunded = pot === contribution * BigInt(CIRCLE_SIZE);
  const step: 0 | 1 | 2 | 3 = claimResult ? 3 : fullyFunded ? 2 : 1;

  const syncFundingState = useCallback(async () => {
    if (!admin || circleId === null) return;
    try {
      const { connect, getCircle } = await import("@sharibo/client");
      const adminClient = await connect(NETWORK, admin);
      const circle = await getCircle(adminClient, circleId);

      setPot(circle.pot);
      setOnChainContributors(circle.contributors);
      setCancelled(circle.cancelled);
      setFeeBps(circle.fee_bps ?? 0);
      setFeeRecipient(circle.fee_recipient ?? "");

      setMembers((prev) =>
        prev.map((m) => {
          const hasFunded =
            circle.contributors.includes(m.keypair.publicKey()) ||
            Boolean(m.freighterKey && circle.contributors.includes(m.freighterKey));
          return { ...m, funded: hasFunded, pending: false };
        }),
      );
    } catch (e) {
      console.error("Failed to sync funding state:", e);
    }
  }, [admin, circleId]);

  useEffect(() => {
    if (circleId !== null && admin) {
      syncFundingState();
    }
  }, [circleId, admin, syncFundingState]);

  useEffect(() => {
    if (circleId !== null && admin && screen === "circle" && !claimResult) {
      const interval = setInterval(() => {
        syncFundingState();
      }, 10000);
      return () => clearInterval(interval);
    }
  }, [circleId, admin, screen, claimResult, syncFundingState]);

  useEffect(() => {
    let mounted = true;
    async function checkEligibility() {
      if (!fullyFunded || claimResult || !circleId || !admin) return;
      try {
        setBusy("Checking member eligibility…");
        const client = await import("@sharibo/client");
        const { computeExternalNullifier, computeNullifierHash, connect, hasClaimed, makeNullifierHash } = client;
        const external = await computeExternalNullifier(circleId, BigInt(round));
        const adminClient = await connect(NETWORK, admin);
        const results = await Promise.all(
          members.map(async (m) => {
            const nullifier = computeNullifierHash(m.identity.identityNullifier, external);
            return await hasClaimed(adminClient, circleId, makeNullifierHash(nullifier));
          }),
        );
        if (!mounted) return;
        setMembers((prev) =>
          prev.map((m, i) => {
            const claimed = results[i] === true;
            const next: Member = { ...m, ineligible: claimed };
            if (claimed) next.ineligibleReason = "Already claimed in this circle";
            else delete next.ineligibleReason;
            return next;
          }),
        );
      } catch (e) {
        setError(toUiError(e, t));
      } finally {
        if (mounted) setBusy(null);
      }
    }
    checkEligibility();
    return () => {
      mounted = false;
    };
  }, [fullyFunded, claimResult, circleId, round, admin]);

  function resetToLanding() {
    const midFlow = fundedCount > 0 && !claimResult;
    if (midFlow) {
      const ok = window.confirm(t("reset.confirm"));
      if (!ok) return;
    }

    claimAbortRef.current?.abort();
    claimAbortRef.current = null;

    setPreviousCircleId(circleId);
    sessionStorage.removeItem("sharibo_demo_state");

    setBusy(null);
    setError(null);
    setCirclePhase("idle");
    setContributionXlm(10);
    setAdmin(null);
    setMembers([]);
    setTree(null);
    setCircleId(null);
    setRound(0);
    setPot(0n);
    setCancelled(false);
    setOnChainContributors([]);
    setClaimantIndex(0);
    setProof(null);
    setNullifierHash(null);
    setClaimResult(null);
    setIsProving(false);
    setProvingElapsedMs(null);
    setNullifierClaimed(false);
    setRejection(null);
    setClaimStage(null);
    setProveElapsedSeconds(0);
    setScreen("landing");
  }

  function dismissResumePrompt() {
    sessionStorage.removeItem("sharibo_demo_state");
    setResumePrompt(null);
  }

  function loadState(parsed: ResumeState) {
    setCirclePhase("loading");
    setContributionXlm(parsed.contributionXlm);
    setAdmin(Keypair.fromSecret(parsed.adminSecret));

    const loadedMembers: Member[] = parsed.members.map((m) => ({
      keypair: Keypair.fromSecret(m.secret),
      identity: m.identity,
      funded: false,
      ...(m.fundHash !== undefined ? { fundHash: m.fundHash } : {}),
      ineligible: m.ineligible ?? false,
      pending: false,
    }));
    setMembers(loadedMembers);

    const newTree = MerkleTree.create(
      LEVELS,
      loadedMembers.map((m) => m.identity.commitment),
    );
    setTree(newTree);

    setCircleId(makeCircleId(parsed.circleId));
    setRound(parsed.round);
    setPot(0n);
    setClaimantIndex(parsed.claimantIndex);
    setProof(parsed.proof);
    setNullifierHash(parsed.nullifierHash);
    setClaimResult(parsed.claimResult);
    setRejection(parsed.rejection);

    setScreen("circle");
    setResumePrompt(null);

    setTimeout(() => syncFundingState(), 100);
    setCirclePhase("ready");
  }

  async function startCircle() {
    setError(null);
    setCirclePhase("loading");
    setBusy("Generating a fresh admin + 5 member identities and funding via friendbot…");
    try {
      const [{ Keypair: SdkKeypair }, client] = await Promise.all([
        import("@stellar/stellar-sdk"),
        import("@sharibo/client"),
      ]);
      const { generateIdentity, MerkleTree: Tree, verificationKeyToContractFormat, connect, createCircle } =
        client;

      setBusy(t("busy.generating"));
      const adminKp = SdkKeypair.random();
      await fundWithFriendbot(adminKp.publicKey());

      const newMembers: Member[] = Array.from({ length: CIRCLE_SIZE }, () => ({
        keypair: SdkKeypair.random(),
        identity: generateIdentity(),
        funded: false,
        ineligible: false,
      }));

      const newTree = Tree.create(
        LEVELS,
        newMembers.map((m) => m.identity.commitment),
      );

      setBusy(t("busy.creating"));
      const vkJson = await fetch("/circuits/verification_key.json").then((r) => r.json());
      const vk = verificationKeyToContractFormat(vkJson);
      const adminClient = await connect(
        { ...NETWORK, onEvent: (e: unknown) => setEvents((prev) => [...prev, e]) },
        adminKp,
      );
      const { result: newCircleId } = await createCircle(adminClient, {
        admin: adminKp.publicKey(),
        token: TOKEN,
        root: newTree.root,
        contribution,
        size: CIRCLE_SIZE,
        vk,
        feeBps: 0,
        feeRecipient: adminKp.publicKey(),
      });

      setAdmin(adminKp);
      setMembers(newMembers);
      setTree(newTree);
      setCircleId(makeCircleId(newCircleId));
      setRound(0);
      setPot(0n);
      setFeeBps(0);
      setFeeRecipient("");
      setScreen("circle");
      setCirclePhase("ready");
    } catch (e) {
      setError(toUiError(e, t));
      setCirclePhase("error");
    } finally {
      setBusy(null);
    }
  }

  async function fundMember(i: number) {
    if (!admin || circleId === null) return;
    setError(null);
    setBusy(t("fund.busy", { index: i + 1 }));
    try {
      const [, { connect, fund }] = await Promise.all([
        import("@stellar/stellar-sdk"),
        import("@sharibo/client"),
      ]);
      const m = members[i];
      if (!m) return;
      await fundWithFriendbot(m.keypair.publicKey());

      setMembers((prev) => prev.map((mm, idx) => (idx === i ? { ...mm, pending: true } : mm)));

      const memberClient = await connect(NETWORK, m.keypair);
      const { hash } = await fund(memberClient, {
        circleId,
        from: m.keypair.publicKey(),
      });

      await syncFundingState();

      setMembers((prev) => prev.map((mm, idx) => (idx === i ? { ...mm, fundHash: hash } : mm)));
    } catch (e) {
      setMembers((prev) => prev.map((mm, idx) => (idx === i ? { ...mm, pending: false } : mm)));
      setError(toUiError(e, t));
    } finally {
      setBusy(null);
    }
  }

  async function fundWithFreighter(i: number) {
    if (!admin || circleId === null) return;
    setError(null);
    setBusy(t("fund.busyFreighter", { index: i + 1 }));
    try {
      const allowedRes = await isAllowed();
      if (!allowedRes.isAllowed) {
        await requestAccess();
      }

      const networkRes = await getNetworkDetails();

      const mismatch = checkNetworkMatch(networkRes.network, NETWORK.networkPassphrase);
      if (mismatch) {
        throw new Error(
          `Your Freighter wallet is connected to ${mismatch.walletNetwork}, ` +
            `but this app is configured for ${mismatch.appNetwork}. ` +
            `Please open Freighter, click the network selector in the upper right, and switch to ${mismatch.appNetwork}.`,
        );
      }

      const addressRes = await getAddress();
      const pubKey = addressRes.address;
      if (!pubKey) {
        throw new Error(t("error.getAddress"));
      }

      const freighterSigner = {
        publicKey: pubKey,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signTransaction: async (txXdr: string, _opts?: any) => {
          const currentNetworkRes = await getNetworkDetails();
          const currentMismatch = checkNetworkMatch(
            currentNetworkRes.network,
            NETWORK.networkPassphrase,
          );
          if (currentMismatch) {
            throw new Error(
              `Your Freighter wallet is connected to ${currentMismatch.walletNetwork}, ` +
                `but this app is configured for ${currentMismatch.appNetwork}. ` +
                `Please open Freighter, click the network selector in the upper right, and switch to ${currentMismatch.appNetwork}.`,
            );
          }

          const signedRes = await freighterSignTx(txXdr, {
            networkPassphrase: currentNetworkRes.networkPassphrase,
          });
          if (signedRes.error) {
            throw new Error(signedRes.error.toString());
          }
          return signedRes.signedTxXdr;
        },
      };

      setMembers((prev) => prev.map((mm, idx) => (idx === i ? { ...mm, pending: true } : mm)));

      const { connect, fund } = await import("@sharibo/client");
      const memberClient = await connect(NETWORK, freighterSigner);
      const { hash } = await fund(memberClient, {
        circleId,
        from: pubKey,
      });

      await syncFundingState();

      setMembers((prev) =>
        prev.map((mm, idx) => (idx === i ? { ...mm, fundHash: hash, freighterKey: pubKey } : mm)),
      );
    } catch (e) {
      if (stateRef.current.status !== "idle" && stateRef.current.status !== "failed") {
        dispatch({ type: "fail", error: (e as Error).message });
      }
    }
  }

  // Fund all members via friendbot with partial success handling.
  // Returns per-account results so the UI can show which succeeded/failed
  // and offer a targeted retry for failed accounts.
  async function fundAllMembers() {
    if (!admin || circleId === null) return;
    setError(null);
    setBusy("Funding all members via friendbot…");
    try {
      const publicKeys = members.map((m) => m.keypair.publicKey());
      const results = await friendbotFundMany(publicKeys, {
        delayMs: 500,
        onProgress: (result) => {
          setFundingResults((prev) => {
            const existing = prev.find((r) => r.publicKey === result.publicKey);
            if (existing) {
              return prev.map((r) => (r.publicKey === result.publicKey ? result : r));
            }
            return [...prev, result];
          });
        },
      });
      setFundingResults(results);

      // For each successful friendbot funding, submit the on-chain fund transaction
      for (const result of results) {
        if (!result.success) continue;
        const memberIndex = members.findIndex((m) => m.keypair.publicKey() === result.publicKey);
        if (memberIndex === -1) continue;
        const m = members[memberIndex];
        try {
          const memberClient = await connect(NETWORK, m.keypair);
          const { hash } = await fund(memberClient, {
            circleId,
            from: m.keypair.publicKey(),
          });
          setMembers((prev) =>
            prev.map((mm, idx) =>
              idx === memberIndex ? { ...mm, funded: true, fundHash: hash } : mm,
            ),
          );
        } catch (e) {
          // On-chain fund failed — mark as not funded so it can be retried
          setMembers((prev) =>
            prev.map((mm, idx) => (idx === memberIndex ? { ...mm, funded: false } : mm)),
          );
          result.success = false;
          result.error =
            e instanceof FriendbotRetryableError ? e : new FriendbotRetryableError(String(e));
        }
      }

      const adminClient = await connect(NETWORK, admin);
      const circle = await getCircle(adminClient, circleId, POLL_RETRY_POLICY);
      setPot(circle.pot);
      setRound(circle.round);

      const failedCount = results.filter((r) => !r.success).length;
      if (failedCount > 0) {
        setError(
          `${failedCount} of ${results.length} accounts failed to fund. Use "Retry failed" to try again.`,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function doClaim() {
    if (!admin || !tree || circleId === null) return;

    claimAbortRef.current?.abort();
    const controller = new AbortController();
    claimAbortRef.current = controller;
    const { signal } = controller;

    setError(null);
    setClaimResult(null);
    setRejection(null);
    setBusy(t("busy.claiming"));
    try {
      const [
        { Keypair: SdkKeypair },
        { computeExternalNullifier, generateProof, verifyProofLocally, connect, claim, hasClaimed },
      ] = await Promise.all([import("@stellar/stellar-sdk"), import("@sharibo/client")]);

      // For each newly successful funding, submit on-chain fund transaction
      for (const result of results) {
        if (!result.success) continue;
        const memberIndex = members.findIndex((m) => m.keypair.publicKey() === result.publicKey);
        if (memberIndex === -1) continue;
        const m = members[memberIndex];
        try {
          const memberClient = await connect(NETWORK, m.keypair);
          const { hash } = await fund(memberClient, {
            circleId,
            from: m.keypair.publicKey(),
          });
          setMembers((prev) =>
            prev.map((mm, idx) =>
              idx === memberIndex ? { ...mm, funded: true, fundHash: hash } : mm,
            ),
          );
        } catch (e) {
          setMembers((prev) =>
            prev.map((mm, idx) => (idx === memberIndex ? { ...mm, funded: false } : mm)),
          );
          result.success = false;
          result.error =
            e instanceof FriendbotRetryableError ? e : new FriendbotRetryableError(String(e));
        }
      }

      const adminClient = await connect(NETWORK, admin);
      const circle = await getCircle(adminClient, circleId, POLL_RETRY_POLICY);
      setPot(circle.pot);
      setRound(circle.round);

      const failedCount = results.filter((r) => !r.success).length;
      if (failedCount > 0) {
        setError(`${failedCount} of ${results.length} accounts still failed. You can retry again.`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function doClaim() {
    if (state.status !== "readyToClaim" || !view.admin || !view.tree || view.circleId === null) return;
    dispatch({
      type: "beginProve",
      busy: "Proving… (a real Groth16 proof is being generated in your browser)",
    });
    try {
      const claimant = view.members[view.claimantIndex];
      const merkleProof = view.tree.proof(view.claimantIndex);
      const externalNullifier = await computeExternalNullifier(view.circleId, BigInt(view.round));

      if (signal.aborted) return;
      setClaimStage("artifacts");
      const [wasm, zkey, vkJson] = await Promise.all([
        fetch("/circuits/membership.wasm")
          .then((r) => r.arrayBuffer())
          .then((b) => new Uint8Array(b)),
        fetch("/circuits/membership_final.zkey", { signal })
          .then((r) => r.arrayBuffer())
          .then((b) => new Uint8Array(b)),
        fetch("/circuits/verification_key.json").then((r) => r.json()),
      ]);

      if (signal.aborted) return;
      setClaimStage("proving");
      setProveElapsedSeconds(0);
      const proveTimer = setInterval(() => setProveElapsedSeconds((s) => s + 1), 1000);
      let generated;
      try {
        generated = await generateProof(
          {
            identityNullifier: claimant.identity.identityNullifier,
            identitySecret: claimant.identity.identitySecret,
            pathElements: merkleProof.pathElements,
            pathIndices: merkleProof.pathIndices,
            root: tree.root,
            externalNullifier,
          },
          wasm,
          zkey,
          { signal, onEvent: (e: unknown) => setEvents((prev) => [...prev, e]) },
        );
      } finally {
        clearInterval(proveTimer);
      }

      setClaimStage("verifying");
      const verifyTimeMs = await verifyProofLocally(
        vkJson,
        generated.publicSignals,
        generated.snarkjsProof,
      );

      setClaimStage("funding");
      const recipient = SdkKeypair.random();
      await fundWithFriendbot(recipient.publicKey());

      if (signal.aborted) return;
      setClaimStage("submitting");
      const adminClient = await connect(
        { ...NETWORK, onEvent: (e: unknown) => setEvents((prev) => [...prev, e]) },
        admin,
      );
      const { hash } = await claim(adminClient, {
        circleId,
        recipient: recipient.publicKey(),
        nullifierHash: generated.nullifierHash,
        externalNullifier: generated.externalNullifier,
        proof: generated.proof,
      });

      if (signal.aborted) return;
      setProof(generated.proof);
      setNullifierHash(generated.nullifierHash);
      setClaimResult({
        recipient: recipient.publicKey(),
        hash,
        proofDurationMs: generated.provingTimeMs,
        verifyTimeMs,
      });
      setNullifierClaimed(await hasClaimed(adminClient, circleId, generated.nullifierHash));

      await syncFundingState();
    } catch (e) {
      setError(toUiError(e, t));
    } finally {
      if (!signal.aborted) {
        setBusy(null);
        setClaimStage(null);
      }
      if (claimAbortRef.current === controller) {
        claimAbortRef.current = null;
      }
    }
  }

  async function claimAgain() {
    if (!admin || circleId === null || !proof || nullifierHash === null) return;
    setError(null);
    setRejection(null);
    setBusy(t("busy.refunding"));
    try {
      const [{ Keypair: SdkKeypair }, { connect, fund, computeExternalNullifier, claim }] =
        await Promise.all([import("@stellar/stellar-sdk"), import("@sharibo/client")]);
      const adminClient = await connect(
        { ...NETWORK, onEvent: (e: unknown) => setEvents((prev) => [...prev, e]) },
        admin,
      );
      for (const m of members) {
        const memberClient = await connect(
          { ...NETWORK, onEvent: (e: unknown) => setEvents((prev) => [...prev, e]) },
          m.keypair,
        );
        await fund(memberClient, { circleId, from: m.keypair.publicKey() });
      }
      const freshExternalNullifier = await computeExternalNullifier(circleId, BigInt(round));

      setBusy(t("busy.replaying"));
      await claim(adminClient, {
        circleId,
        recipient: SdkKeypair.random().publicKey(),
        nullifierHash,
        externalNullifier: freshExternalNullifier,
        proof,
      });
      setRejection(t("rejection.unexpected"));
    } catch (e) {
      setRejection(toUiError(e, t));
    } finally {
      try {
        await syncFundingState();
      } catch {
        // best-effort refresh only
      }
      setBusy(null);
    }
  }

  async function doCancelCircle() {
    if (!admin || circleId === null) return;
    setError(null);

    const refundCount = onChainContributors.length;
    const refundTotal = (Number(pot) / 1e7).toFixed(1);

    const confirmed = window.confirm(
      t("cancel.confirmation", { count: refundCount, total: refundTotal }),
    );

    if (!confirmed) return;

    setBusy(t("cancel.busy"));
    try {
      const { connect, cancelCircle } = await import("@sharibo/client");
      const adminClient = await connect(NETWORK, admin);
      await cancelCircle(adminClient, { circleId });

      await syncFundingState();
    } catch (e) {
      setError(toUiError(e, t));
    } finally {
      setBusy(null);
    }
  }

  return {
    screen,
    circlePhase,
    busy,
    error,
    contributionXlm,
    admin,
    members,
    circleId,
    round,
    pot,
    proof,
    nullifierHash,
    feeBps,
    feeRecipient,
    onChainContributors,
    cancelled,
    claimantIndex,
    setClaimantIndex,
    claimResult,
    isProving,
    nullifierClaimed,
    rejection,
    claimStage,
    proveElapsedSeconds,
    stepTimings,
    previousCircleId,
    prevCircle,
    hasFreighter,
    hasAdmin: admin !== null,
    resumePrompt,
    fundedCount,
    fullyFunded,
    step,
    circleSize: CIRCLE_SIZE,
    dismissResumePrompt,
    loadState,
    resetToLanding,
    startCircle,
    fundMember,
    fundWithFreighter,
    doClaim,
    claimAgain,
    doCancelCircle,
  };
}

interface ResumeMember {
  secret: string;
  identity: Identity;
  fundHash?: string;
  ineligible?: boolean;
}

interface ResumeState {
  contributionXlm: number;
  adminSecret: string;
  members: ResumeMember[];
  circleId: bigint;
  round: number;
  claimantIndex: number;
  proof: ContractProof | null;
  nullifierHash: NullifierHash | null;
  claimResult: ClaimResult | null;
  rejection: string | null;
}
