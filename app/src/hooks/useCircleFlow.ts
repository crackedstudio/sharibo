import { useReducer, useRef } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import {
  isConnected,
  requestAccess,
  isAllowed,
  getAddress,
  getNetworkDetails,
  signTransaction as freighterSignTx,
} from "@stellar/freighter-api";
import {
  generateIdentity,
  computeExternalNullifier,
  computeNullifierHash,
  MerkleTree,
  verificationKeyToContractFormat,
  connect,
  createCircle,
  fund,
  claim,
  cancelCircle,
  getCircle,
  hasClaimed,
  generateProof,
  verifyProofLocally,
  TREE_LEVELS,
  xlmToStroops,
  POLL_RETRY_POLICY,
  PATIENT_RETRY_POLICY,
  type ContractProof,
  TREE_LEVELS,
  getArtifacts,
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
function replacer(key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return BIGINT_MARKER + value.toString();
  }
  return value;
}

function reviver(key: string, value: unknown): unknown {
  if (typeof value === "string" && value.startsWith(BIGINT_MARKER)) {
    return BigInt(value.slice(BIGINT_MARKER.length));
  }
  return value;
}

// Derive constants from config (same as App.tsx does)
const NETWORK = {
  contractId: config?.contractId ?? "",
  rpcUrl: config?.rpcUrl ?? "",
  networkPassphrase: config?.networkPassphrase ?? "",
};
const TOKEN = config?.testTokenContractId ?? "";
const LEVELS = TREE_LEVELS;

// All the state and on-chain calls behind a single demo run: create a
// circle, fund it from the configured members, prove + claim, then optionally replay the
// same proof to demonstrate nullifier rejection. Kept as one hook (rather
// than split further) because every step depends on state written by the
// previous one — App.tsx only composes the resulting state and callbacks
// into screens. Transitions go through circleReducer; this hook does not
// keep a parallel set of useState values.
export function useCircleFlow() {
  const [screen, setScreen] = useState<"landing" | "circle">("landing");
  const [circlePhase, setCirclePhase] = useState<CirclePhase>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const [provingElapsedMs, setProvingElapsedMs] = useState<number | null>(null);
  const [nullifierClaimed, setNullifierClaimed] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const [feeEstimate, setFeeEstimate] = useState<FeeEstimate | null>(null);
  // Survives a reset so the landing screen can point back at the circle you
  // just left — it keeps living on-chain even though the UI has moved on.
  const [previousCircleId, setPreviousCircleId] = useState<bigint | null>(null);
  // Track friendbot funding results for partial success handling and retry
  const [fundingResults, setFundingResults] = useState<FriendbotFundResult[]>([]);

  const contribution = xlmToStroops(view.contributionXlm);
  const fundedCount = view.members.filter((m) => m.funded).length;
  const fullyFunded = isCircleFullyFunded(view.pot, view.contributionXlm);

  // Reset every piece of circle state and return to the landing screen. The
  // circle itself is never touched on-chain — it lives on forever; we just
  // stop pointing the UI at it (and remember its id so the landing screen can
  // link back to it). Confirm first only when a circle is mid-flow — funded
  // but not yet claimed — so an accidental click can't throw away an
  // in-progress round; a completed or untouched circle resets silently.
  function resetToLanding() {
    const midFlow = fundedCount > 0 && !view.claimResult;
    if (midFlow) {
      const ok = typeof window !== "undefined" && window.confirm
        ? window.confirm(
            t
              ? t("reset.confirm")
              : "This circle is funded but hasn't claimed yet. Start over anyway?\n\nYour current circle stays on-chain — you just won't see it here."
          )
        : true;
      if (!ok) return;
    }

    dispatch({ type: "reset", previousCircleId: view.circleId });
  }

  function loadState(parsed: SavedDemoState) {
    setCirclePhase("loading");
    setContributionXlm(parsed.contributionXlm ?? 10);
    const adminKp = Keypair.fromSecret(parsed.adminSecret);
    setAdmin(adminKp);

    const loadedMembers: Member[] = parsed.members.map((m) => ({
      keypair: Keypair.fromSecret(m.secret),
      identity: m.identity,
      funded: false,
      fundHash: m.fundHash,
      ineligible: m.ineligible ?? false,
      pending: false,
    }));
    setMembers(loadedMembers);

    const newTree = MerkleTree.create(
      LEVELS,
      loadedMembers.map((m) => m.identity.commitment),
    );
    setTree(newTree);

    const parsedCircleId = makeCircleId(BigInt(parsed.circleId));
    setCircleId(parsedCircleId);
    setRound(parsed.round ?? 0);
    setPot(0n);
    setClaimantIndex(parsed.claimantIndex ?? 0);
    setProof(parsed.proof ?? null);
    setNullifierHash(parsed.nullifierHash ?? null);
    setClaimResult(parsed.claimResult ?? null);
    setRejection(parsed.rejection ?? null);

    setScreen("circle");
    setResumePrompt(null);

    // Sync on-chain after loading state
    setTimeout(async () => {
      try {
        const adminClient = await connect(NETWORK, adminKp);
        const circle = await getCircle(adminClient, parsedCircleId, POLL_RETRY_POLICY);
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
          })
        );
      } catch (e) {
        console.error("Failed to sync on resume:", e);
      }
    }, 100);
    setCirclePhase("ready");
  }

  function dismissResumePrompt() {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("sharibo_demo_state");
    }
    setResumePrompt(null);
  }

  async function startCircle() {
    if (state.status !== "idle" && !(state.status === "failed" && state.circle === null)) return;
    dispatch({
      type: "start",
      busy: "Generating a fresh admin + 5 member identities and funding via friendbot…",
    });
    try {
      const adminKp = Keypair.random();
      await friendbotFund(adminKp.publicKey());

      const newMembers: Member[] = Array.from({ length: CIRCLE_SIZE }, () => ({
        keypair: Keypair.random(),
        identity: generateIdentity(),
        funded: false,
        ineligible: false,
      }));

      const newTree = MerkleTree.create(
        LEVELS,
        newMembers.map((m) => m.identity.commitment),
      );

      dispatch({ type: "setBusy", busy: "Creating the circle on testnet…" });
      const baseUrl = import.meta.env.BASE_URL.endsWith("/")
        ? import.meta.env.BASE_URL
        : `${import.meta.env.BASE_URL}/`;
      const vkJson = await fetch(`${baseUrl}circuits/verification_key.json`).then((r) => r.json());
      const vk = verificationKeyToContractFormat(vkJson);
      const adminClient = await connect({ ...NETWORK, onEvent }, adminKp);
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

      const circle: CircleSnapshot = {
        contributionXlm: view.contributionXlm,
        admin: adminKp,
        members: newMembers,
        tree: newTree,
        circleId: makeCircleId(newCircleId),
        round: 0,
        pot: 0n,
        claimantIndex: 0,
        feeBps: 0,
        feeRecipient: "",
        onChainContributors: [],
        cancelled: false,
        stepTimings: {},
        feeEstimate: null,
      };
      dispatch({ type: "created", circle });
    } catch (e) {
      if (stateRef.current.status !== "idle" && stateRef.current.status !== "failed") {
        dispatch({ type: "fail", error: (e as Error).message });
      }
    }
  }

  async function fundMember(i: number) {
    if (!view.admin || view.circleId === null) return;
    if (
      state.status !== "funding" &&
      state.status !== "readyToClaim" &&
      state.status !== "claimed" &&
      state.status !== "failed"
    ) {
      return;
    }
    dispatch({ type: "setBusy", busy: `Funding from member ${i + 1}…` });
    dispatch({ type: "patchMember", index: i, pending: true });
    try {
      const m = view.members[i];
      await friendbotFund(m.keypair.publicKey());

      setMembers((prev) =>
        prev.map((mm, idx) => (idx === i ? { ...mm, pending: true } : mm)),
      );

      const memberClient = await connect(NETWORK, m.keypair);
      const { hash } = await fund(memberClient, {
        circleId: view.circleId,
        from: m.keypair.publicKey(),
      });

      await syncFundingState();

      setMembers((prev) =>
        prev.map((mm, idx) => (idx === i ? { ...mm, funded: true, fundHash: hash, pending: false } : mm)),
      );
    } catch (e) {
      setMembers((prev) =>
        prev.map((mm, idx) => (idx === i ? { ...mm, pending: false } : mm)),
      );
      setError(toUiError(e, t));
    } finally {
      setBusy(null);
    }
  }

  async function fundWithFreighter(i: number) {
    if (!admin || circleId === null) return;
    setError(null);
    setBusy(t ? t("fund.busyFreighter", { index: i + 1 }) : `Funding member ${i + 1} with Freighter…`);
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
        throw new Error(t ? t("error.getAddress") : "Failed to get address from Freighter");
      }

      const freighterSigner = {
        publicKey: pubKey,
        signTransaction: async (txXdr: string) => {
          const currentNetworkRes = await getNetworkDetails();
          const currentMismatch = checkNetworkMatch(currentNetworkRes.network, NETWORK.networkPassphrase);
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

      setMembers((prev) =>
        prev.map((mm, idx) => (idx === i ? { ...mm, pending: true } : mm)),
      );

      const memberClient = await connect(NETWORK, freighterSigner);
      const { hash } = await fund(memberClient, {
        circleId,
        from: pubKey,
      });

      await syncFundingState();

      setMembers((prev) =>
        prev.map((mm, idx) => (idx === i ? { ...mm, funded: true, fundHash: hash, freighterKey: pubKey, pending: false } : mm)),
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

  // Retry friendbot funding for only the accounts that previously failed
  async function retryFailedFunding() {
    if (!admin || circleId === null) return;
    const failedKeys = fundingResults.filter((r) => !r.success).map((r) => r.publicKey);
    if (failedKeys.length === 0) return;

    setError(null);
    setBusy(`Retrying funding for ${failedKeys.length} account(s)…`);
    try {
      const results = await friendbotFundMany(failedKeys, {
        delayMs: 500,
        onProgress: (result) => {
          setFundingResults((prev) =>
            prev.map((r) => (r.publicKey === result.publicKey ? result : r)),
          );
        },
      });

      // Merge new results with existing ones
      setFundingResults((prev) => {
        const merged = [...prev];
        for (const result of results) {
          const idx = merged.findIndex((r) => r.publicKey === result.publicKey);
          if (idx >= 0) merged[idx] = result;
          else merged.push(result);
        }
        return merged;
      });

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
      onEvent?.({ type: "artifact:started" });
      const artStart = Date.now();
      const baseUrl =
        typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
          ? import.meta.env.BASE_URL.endsWith("/")
            ? import.meta.env.BASE_URL
            : `${import.meta.env.BASE_URL}/`
          : "/";
      const [wasm, zkey, vkJson] = await Promise.all([
        fetch(`${baseUrl}circuits/membership.wasm`)
          .then((r) => r.arrayBuffer())
          .then((b) => new Uint8Array(b)),
        fetch(`${baseUrl}circuits/membership_final.zkey`, { signal })
          .then((r) => r.arrayBuffer())
          .then((b) => new Uint8Array(b)),
        fetch(`${baseUrl}circuits/verification_key.json`).then((r) => r.json()),
      ]);
      timings.artifacts = Date.now() - artStart;
      onEvent?.({
        type: "artifact:ready",
        loaded: wasm.byteLength + zkey.byteLength,
        total: wasm.byteLength + zkey.byteLength,
      });

      dispatch({ type: "proveStage", stage: "proving", proveElapsedSeconds: 0 });
      const generated = await generateProof(
        {
          identityNullifier: claimant.identity.identityNullifier,
          identitySecret: claimant.identity.identitySecret,
          pathElements: merkleProof.pathElements,
          pathIndices: merkleProof.pathIndices,
          root: view.tree.root,
          externalNullifier,
        },
        wasm,
        zkey,
      );

      // Local verification catches a bad proof before any network call.
      const verifyTimeMs = await verifyProofLocally(vkJson, generated.publicSignals, generated.snarkjsProof);

      // Fund a fresh recipient before estimating — the estimate needs a valid
      // recipient address in the simulated transaction.
      dispatch({ type: "setBusy", busy: "Funding a fresh, unlinked recipient…" });
      const recipient = Keypair.random();
      const fundStart = Date.now();
      await friendbotFund(recipient.publicKey());
      timings.fundingRecipient = Date.now() - fundStart;

      // Dry-run simulation for the fee estimate. This is best-effort:
      // if simulation fails we proceed without an estimate rather than
      // blocking the claim.
      dispatch({ type: "setBusy", busy: "Estimating claim fee…" });
      const adminClient = await connect(NETWORK, view.admin);
      let estimate = null;
      try {
        estimate = await estimateClaimFee(adminClient, {
          circleId: view.circleId,
          recipient: recipient.publicKey(),
          nullifierHash: generated.nullifierHash,
          externalNullifier: generated.externalNullifier,
          proof: generated.proof,
        });
        dispatch({ type: "setFeeEstimate", feeEstimate: estimate });
      } catch {
        estimate = null;
      }

      setBusy("Submitting the claim…");
      const { hash, feeCharged } = await claim(
        adminClient,
        {
          circleId,
          recipient: recipient.publicKey(),
          nullifierHash: generated.nullifierHash,
          externalNullifier: generated.externalNullifier,
          proof: generated.proof,
        },
        PATIENT_RETRY_POLICY,
      );
      timings.submitting = Date.now() - submitStart;
      setStepTimings(timings);

      if (signal.aborted) return;
      setProof(generated.proof);
      setNullifierHash(generated.nullifierHash);
      setClaimResult({
        recipient: recipient.publicKey(),
        hash,
        proofDurationMs: generated.provingTimeMs ?? timings.proving ?? 0,
        verifyTimeMs: typeof verifyTimeMs === "number" ? verifyTimeMs : 1,
      });

      const claimed = await hasClaimed(adminClient, circleId, generated.nullifierHash);
      setNullifierClaimed(claimed);

      await syncFundingState();
    } catch (e) {
      if (stateRef.current.status !== "idle" && stateRef.current.status !== "failed") {
        dispatch({ type: "fail", error: (e as Error).message });
      }
    }
  }

  async function claimAgain() {
    if (state.status !== "claimed" || !view.admin || view.circleId === null || !view.proof || view.nullifierHash === null) {
      return;
    }
    dispatch({
      type: "setBusy",
      busy: "Refunding a new round, then replaying the same proof's nullifier…",
      clearRejection: true,
    });
    try {
      // Fund round `round` again so this exercises the nullifier-reuse
      // check specifically, not just "the pot is empty" — the same
      // proof's nullifier gets rejected even against a fresh, funded round.
      const adminClient = await connect(NETWORK, view.admin);
      for (const m of view.members) {
        const memberClient = await connect(NETWORK, m.keypair);
        await fund(memberClient, { circleId: view.circleId, from: m.keypair.publicKey() });
      }
      const freshExternalNullifier = await computeExternalNullifier(view.circleId, BigInt(view.round));

      setBusy(t ? t("busy.replaying") : "Replaying the used nullifier…");
      await claim(
        adminClient,
        {
          circleId,
          recipient: Keypair.random().publicKey(),
          nullifierHash,
          externalNullifier: freshExternalNullifier,
          proof,
        },
        PATIENT_RETRY_POLICY,
      );
      setRejection(t ? t("rejection.unexpected") : "Unexpected: the replayed claim was accepted (this should never happen).");
    } catch (e) {
      setRejection(toUiError(e, t));
    } finally {
      try {
        await syncFundingState();
      } catch {
        // best-effort refresh
      }
    } catch (e) {
      dispatch({ type: "recordRejection", rejection: (e as Error).message });
    } finally {
      dispatch({ type: "clearBusy" });
    }
  }

  function setClaimantIndex(index: number) {
    dispatch({ type: "selectClaimant", index });
  }

  return {
    screen: view.screen,
    circlePhase: view.circlePhase,
    busy: view.busy,
    error: view.error,
    contributionXlm: view.contributionXlm,
    members: view.members,
    circleId: view.circleId,
    round: view.round,
    pot: view.pot,
    claimantIndex: view.claimantIndex,
    setClaimantIndex,
    claimResult: view.claimResult,
    rejection: view.rejection,
    previousCircleId: view.previousCircleId,
    fundedCount,
    fullyFunded,
    feeEstimate,
    fundingResults,
    resetToLanding,
    startCircle,
    fundMember,
    fundAllMembers,
    retryFailedFunding,
    doClaim,
    claimAgain,
    doCancelCircle,
    loadState,
    dismissResumePrompt,
    syncFundingState,
  };
}
