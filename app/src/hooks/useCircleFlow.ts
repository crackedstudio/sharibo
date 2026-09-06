import { useState } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import {
  generateIdentity,
  computeExternalNullifier,
  MerkleTree,
  generateProof,
  verifyProofLocally,
  estimateClaimFee,
  verificationKeyToContractFormat,
  connect,
  createCircle,
  fund,
  claim,
  getCircle,
  xlmToStroops,
  type ContractProof,
  type FeeEstimate,
  TREE_LEVELS,
  getArtifacts,
} from "@sharibo/client";
import { config } from "../config.js";
import { friendbotFund } from "../lib/friendbot.js";
import type { Member, ClaimResult } from "../types.js";

/** Where the circle view is in its on-chain load cycle, so the UI can show
 *  skeletons instead of an empty ring while the first read is in flight. */
export type CirclePhase = "idle" | "loading" | "ready" | "error";

// Derive constants from config (same as App.tsx does)
const NETWORK = {
  contractId: config.contractId,
  rpcUrl: config.rpcUrl,
  networkPassphrase: config.networkPassphrase,
};
const TOKEN = config.testTokenContractId;
const LEVELS = TREE_LEVELS;
const CIRCLE_SIZE = 5;

// All the state and on-chain calls behind a single demo run: create a
// circle, fund it from 5 members, prove + claim, then optionally replay the
// same proof to demonstrate nullifier rejection. Kept as one hook (rather
// than split further) because every step depends on state written by the
// previous one — App.tsx only composes the resulting state and callbacks
// into screens.
export function useCircleFlow() {
  const [screen, setScreen] = useState<"landing" | "circle">("landing");
  const [circlePhase, setCirclePhase] = useState<CirclePhase>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [contributionXlm, setContributionXlm] = useState(10);
  const [admin, setAdmin] = useState<Keypair | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tree, setTree] = useState<MerkleTree | null>(null);
  const [circleId, setCircleId] = useState<bigint | null>(null);
  const [round, setRound] = useState(0);
  const [pot, setPot] = useState(0n);
  const [claimantIndex, setClaimantIndex] = useState(0);
  const [proof, setProof] = useState<ContractProof | null>(null);
  const [nullifierHash, setNullifierHash] = useState<bigint | null>(null);
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [feeEstimate, setFeeEstimate] = useState<FeeEstimate | null>(null);
  // Survives a reset so the landing screen can point back at the circle you
  // just left — it keeps living on-chain even though the UI has moved on.
  const [previousCircleId, setPreviousCircleId] = useState<bigint | null>(null);

  const contribution = xlmToStroops(contributionXlm);
  const fundedCount = members.filter((m) => m.funded).length;
  const fullyFunded = pot === contribution * BigInt(CIRCLE_SIZE);

  // Reset every piece of React state back to its initial value and return to
  // the landing screen. The circle itself is never touched on-chain — it lives
  // on forever; we just stop pointing the UI at it (and remember its id so the
  // landing screen can link back to it). Confirm first only when a circle is
  // mid-flow — funded but not yet claimed — so an accidental click can't throw
  // away an in-progress round; a completed or untouched circle resets silently.
  function resetToLanding() {
    const midFlow = fundedCount > 0 && !claimResult;
    if (midFlow) {
      const ok = window.confirm(
        "This circle is funded but hasn't claimed yet. Start over anyway?\n\n" +
          "Your current circle stays on-chain — you just won't see it here.",
      );
      if (!ok) return;
    }

    setPreviousCircleId(circleId);

    setBusy(null);
    setError(null);
    setContributionXlm(10);
    setAdmin(null);
    setMembers([]);
    setTree(null);
    setCircleId(null);
    setRound(0);
    setPot(0n);
    setClaimantIndex(0);
    setProof(null);
    setNullifierHash(null);
    setClaimResult(null);
    setRejection(null);
    setFeeEstimate(null);
    setScreen("landing");
  }

  async function startCircle() {
    setError(null);
    setCirclePhase("loading");
    setBusy("Generating a fresh admin + 5 member identities and funding via friendbot…");
    try {
      const adminKp = Keypair.random();
      await friendbotFund(adminKp.publicKey());

      const newMembers: Member[] = Array.from({ length: CIRCLE_SIZE }, () => ({
        keypair: Keypair.random(),
        identity: generateIdentity(),
        funded: false,
      }));

      const newTree = MerkleTree.create(
        LEVELS,
        newMembers.map((m) => m.identity.commitment),
      );

      setBusy("Creating the circle on testnet…");
      const baseUrl = import.meta.env.BASE_URL.endsWith("/")
        ? import.meta.env.BASE_URL
        : `${import.meta.env.BASE_URL}/`;
      const vkJson = await fetch(`${baseUrl}circuits/verification_key.json`).then((r) => r.json());
      const vk = verificationKeyToContractFormat(vkJson);
      const adminClient = await connect(NETWORK, adminKp);
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
      setCircleId(newCircleId);
      setRound(0);
      setPot(0n);
      setScreen("circle");
      setCirclePhase("ready");
    } catch (e) {
      setError((e as Error).message);
      setCirclePhase("error");
    } finally {
      setBusy(null);
    }
  }

  async function fundMember(i: number) {
    if (!admin || circleId === null) return;
    setError(null);
    setBusy(`Funding from member ${i + 1}…`);
    try {
      const m = members[i];
      await friendbotFund(m.keypair.publicKey());
      const memberClient = await connect(NETWORK, m.keypair);
      const { hash } = await fund(memberClient, {
        circleId,
        from: m.keypair.publicKey(),
      });
      setMembers((prev) =>
        prev.map((mm, idx) => (idx === i ? { ...mm, funded: true, fundHash: hash } : mm)),
      );
      const adminClient = await connect(NETWORK, admin);
      const circle = await getCircle(adminClient, circleId);
      setPot(circle.pot);
      setRound(circle.round);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function doClaim() {
    if (!admin || !tree || circleId === null) return;
    setError(null);
    setClaimResult(null);
    setRejection(null);
    setFeeEstimate(null);
    setBusy("Proving… (a real Groth16 proof is being generated in your browser)");
    try {
      const claimant = members[claimantIndex];
      const merkleProof = tree.proof(claimantIndex);
      const externalNullifier = await computeExternalNullifier(circleId, BigInt(round));

      // Fetch artifacts (via configured getArtifacts) and VK in parallel.
      const baseUrl = import.meta.env.BASE_URL.endsWith("/")
        ? import.meta.env.BASE_URL
        : `${import.meta.env.BASE_URL}/`;
      const [{ wasm, zkey }, vkJson] = await Promise.all([
        getArtifacts(),
        fetch(`${baseUrl}circuits/verification_key.json`).then((r) => r.json()),
      ]);

      const generated = await generateProof(
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
      );

      // Local verification catches a bad proof before any network call.
      await verifyProofLocally(vkJson, generated.publicSignals, generated.snarkjsProof);

      // Fund a fresh recipient before estimating — the estimate needs a valid
      // recipient address in the simulated transaction.
      setBusy("Funding a fresh, unlinked recipient…");
      const recipient = Keypair.random();
      await friendbotFund(recipient.publicKey());

      // Dry-run simulation for the fee estimate. This is best-effort:
      // if simulation fails we proceed without an estimate rather than
      // blocking the claim.
      setBusy("Estimating claim fee…");
      const adminClient = await connect(NETWORK, admin);
      const estimate = await estimateClaimFee(adminClient, {
        circleId,
        recipient: recipient.publicKey(),
        nullifierHash: generated.nullifierHash,
        externalNullifier: generated.externalNullifier,
        proof: generated.proof,
      });
      setFeeEstimate(estimate);

      setBusy("Submitting the claim…");
      const { hash, feeCharged } = await claim(adminClient, {
        circleId,
        recipient: recipient.publicKey(),
        nullifierHash: generated.nullifierHash,
        externalNullifier: generated.externalNullifier,
        proof: generated.proof,
      });

      setProof(generated.proof);
      setNullifierHash(generated.nullifierHash);
      setClaimResult({
        recipient: recipient.publicKey(),
        hash,
        feeCharged,
        feeEstimate: estimate ?? undefined,
      });

      const circle = await getCircle(adminClient, circleId);
      setPot(circle.pot);
      setRound(circle.round);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function claimAgain() {
    if (!admin || circleId === null || !proof || nullifierHash === null) return;
    setError(null);
    setRejection(null);
    setBusy("Refunding a new round, then replaying the same proof's nullifier…");
    try {
      // Fund round `round` again so this exercises the nullifier-reuse
      // check specifically, not just "the pot is empty" — the same
      // proof's nullifier gets rejected even against a fresh, funded round.
      const adminClient = await connect(NETWORK, admin);
      for (const m of members) {
        const memberClient = await connect(NETWORK, m.keypair);
        await fund(memberClient, { circleId, from: m.keypair.publicKey() });
      }
      const freshExternalNullifier = await computeExternalNullifier(circleId, BigInt(round));

      setBusy("Replaying the used nullifier…");
      await claim(adminClient, {
        circleId,
        recipient: Keypair.random().publicKey(),
        nullifierHash,
        externalNullifier: freshExternalNullifier,
        proof,
      });
      setRejection("Unexpected: the replayed claim was accepted (this should never happen).");
    } catch (e) {
      setRejection((e as Error).message);
    } finally {
      // Reflect the on-chain state either way: the re-funding above happened
      // for real even though the replayed claim itself was rejected.
      try {
        const adminClient = await connect(NETWORK, admin);
        const circle = await getCircle(adminClient, circleId);
        setPot(circle.pot);
        setRound(circle.round);
      } catch {
        // best-effort refresh only
      }
      setBusy(null);
    }
  }

  return {
    screen,
    circlePhase,
    busy,
    error,
    contributionXlm,
    members,
    circleId,
    round,
    pot,
    claimantIndex,
    setClaimantIndex,
    claimResult,
    rejection,
    previousCircleId,
    fundedCount,
    fullyFunded,
    feeEstimate,
    resetToLanding,
    startCircle,
    fundMember,
    doClaim,
    claimAgain,
  };
}
