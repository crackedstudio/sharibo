import { useState, useRef, useEffect } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import {
  isConnected,
  requestAccess,
  isAllowed,
  getAddress,
  getNetworkDetails,
  signTransaction as freighterSignTx
} from "@stellar/freighter-api";
import {
  generateIdentity,
  computeExternalNullifier,
  MerkleTree,
  generateProof,
  verifyProofLocally,
  verificationKeyToContractFormat,
  connect,
  createCircle,
  fund,
  claim,
  getCircle,
  hasClaimed,
  TREE_LEVELS,
  type Identity,
  type ContractProof,
  ContractError,
  RpcError,
  ProvingError,
  InvalidInputError,
  describeError,
} from "@sharibo/client";
import { config, configError } from "./config";
import { useI18n } from "./i18n";
import { usePoliteLiveRegion } from "./usePoliteLiveRegion";
import {
  friendbotFund as fundWithFriendbot,
  FriendbotRetryableError,
  FRIEND_BOT_RATE_LIMIT_MESSAGE,
} from "./lib/friendbot";

const BIGINT_MARKER = 'BIGINT::';
function replacer(key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return BIGINT_MARKER + value.toString();
  }
  return value;
}

function reviver(key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith(BIGINT_MARKER)) {
    return BigInt(value.slice(BIGINT_MARKER.length));
  }
  return value;
}

const NETWORK = {
  contractId: config.contractId,
  rpcUrl: config.rpcUrl,
  networkPassphrase: config.networkPassphrase,
};
const TOKEN = config.testTokenContractId;
const LEVELS = TREE_LEVELS;
const CIRCLE_SIZE = 5;
const STROOPS_PER_XLM = 10_000_000n;
const README_URL = "https://github.com/crackedstudio/sharibo#honest-limitations";

const isTestnet = Boolean(NETWORK.networkPassphrase?.includes("Test SDF Network"));
const BANNER_TEXT = isTestnet ? "Stellar testnet — no real funds" : "";

function TestnetBanner() {
  if (!BANNER_TEXT) return null;
  return (
    <div className="testnet-banner">
      <span>{BANNER_TEXT}</span>
      <a className="banner-link" href={README_URL} target="_blank" rel="noreferrer">
        honest limitations ↗
      </a>
    </div>
  );
}

const NAMES = [
  "ajo",
  "esusu",
  "tanda",
  "cundina",
  "susu",
  "tontine",
  "junta",
  "pandero",
  "consórcio",
  "hui",
  "paluwagan",
  "chit fund",
];

function toUiError(error: unknown): string {
  if (error instanceof FriendbotRetryableError) {
    return FRIEND_BOT_RATE_LIMIT_MESSAGE;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong. Please retry.";
}

// Same shape as toUiError, but additionally recognizes Sharibo contract
// rejections — the raw `Error(Contract, #4)` Soroban surfaces gets rendered
// as "AlreadyClaimed: this proof's nullifier was already used; ..." via
// describeError() (packages/client/src/errors.ts) instead of the bare error
// code. Falls back to the same Friendbot special-case and raw-message
// behavior as toUiError for anything that isn't a recognized contract error.
function getErrorMessage(error: unknown): string {
  if (error instanceof FriendbotRetryableError) {
    return FRIEND_BOT_RATE_LIMIT_MESSAGE;
  }
  return describeError(error);
}

function explorerAccount(address: string): string {
  return `https://stellar.expert/explorer/testnet/account/${address}`;
}
function explorerContract(): string {
  return `https://stellar.expert/explorer/testnet/contract/${NETWORK.contractId}`;
}
function short(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

// Every truncated value on screen (addresses, tx hashes) needs to be
// pasteable in full somewhere else — a CLI call, an explorer search — so
// this pairs with each `short(...)` display. Falls back to a prompt() (which
// itself is trivially copyable) when the async Clipboard API isn't
// available, e.g. non-secure contexts.
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  async function handleCopy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      window.prompt(`Clipboard unavailable — copy ${label} manually:`, value);
    }
  }

  return (
    <button
      type="button"
      className="copy-btn"
      onClick={handleCopy}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
    >
      {copied ? "✓" : "📋"}
    </button>
  );
}

interface Member {
  keypair: Keypair;
  identity: Identity;
  funded: boolean;
  fundHash?: string;
  freighterKey?: string;
}

interface ClaimResult {
  recipient: string;
  hash: string;
  proofDurationMs: number;
  verifyTimeMs: number;
}

// The visible stages of doClaim, in the order they actually occur. snarkjs's
// fullProve is one opaque call, so "proving" covers witness computation +
// proof generation together — it gets its own elapsed timer instead of a
// substage breakdown, since we can't observe a finer boundary inside it.
type ClaimStage = "artifacts" | "proving" | "verifying" | "funding" | "submitting";

const CLAIM_STAGE_LABELS: Record<ClaimStage, string> = {
  artifacts: "Fetching proving artifacts (wasm + zkey)…",
  proving: "Proving…",
  verifying: "Verifying proof locally…",
  funding: "Funding a fresh, unlinked recipient…",
  submitting: "Submitting the claim…",
};

const CLAIM_STAGES: ClaimStage[] = ["artifacts", "proving", "verifying", "funding", "submitting"];

// So a claim never reads as a hung tab: each real substage of doClaim gets
// its own line here (fullProve itself stays one opaque "proving" step, per
// snarkjs, but that step gets a live elapsed-seconds counter + spinner so a
// slow prove still visibly ticks rather than sitting static).
function ClaimProgress({ stage, elapsedSeconds }: { stage: ClaimStage; elapsedSeconds: number }) {
  const activeIndex = CLAIM_STAGES.indexOf(stage);
  return (
    <div className="claim-progress">
      <div className="stepper">
        {CLAIM_STAGES.map((s, i) => (
          <div
            key={s}
            className={`step ${i < activeIndex ? "done" : i === activeIndex ? "active" : ""}`}
          >
            <span className="step-dot">{i < activeIndex ? "✓" : i + 1}</span>
            {CLAIM_STAGE_LABELS[s]}
          </div>
        ))}
      </div>
      {stage === "proving" && (
        <p className="techline">
          <span className="spinner" aria-hidden="true" /> Groth16 · BLS12-381 · 1,452 constraints ·
          proving locally in your browser, nothing sent anywhere until the proof is done ·{" "}
          {elapsedSeconds}s elapsed
        </p>
      )}
    </div>
  );
}

function Stepper({ step }: { step: 0 | 1 | 2 | 3 }) {
  const { t } = useI18n();
  const labels = [t("step.create"), t("step.fund"), t("step.proveClaim"), t("step.unlinked")];
  return (
    // nav + ol give screen readers "step N of 4" list semantics without
    // changing any visual output — CSS targets .stepper and .step as before.
    <nav aria-label="Circle progress">
      <ol className="stepper" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {labels.map((label, i) => {
          const state = i < step ? "done" : i === step ? "active" : "";
          return (
            <li
              key={label}
              className={`step ${state}`}
              // aria-current="step" marks the single active step; completed
              // and upcoming steps get no aria-current attribute at all.
              {...(i === step ? { "aria-current": "step" as const } : {})}
            >
              {/* The dot (✓ / number) is decorative — the li text already
                  conveys position, so hide the dot from the AT tree. */}
              <span className="step-dot" aria-hidden="true">
                {i < step ? "✓" : i + 1}
              </span>
              {label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function NetworkBanner() {
  const isTestnet = NETWORK.networkPassphrase.toLowerCase().includes("test");
  if (!isTestnet) return null;
  return (
    <div className="network-banner">
      Stellar testnet — no real funds ·{" "}
      <a
        href="https://github.com/glorious21-coder/sharibo#honest-limitations"
        target="_blank"
        rel="noreferrer"
      >
        limitations ↗
      </a>
    </div>
  );
}

// Purely presentational: after a claim, none of the 5 nodes are highlighted
// as "the one that claimed" — that's the point. From outside the ring, all
// five remain equally plausible; only the demo operator (via the radio
// picker below) ever knows which one actually did.
function useRingRadius(): number {
  const [radius, setRadius] = useState(100);

  useEffect(() => {
    const read = () => {
      const value = getComputedStyle(document.documentElement).getPropertyValue("--ring-radius");
      setRadius(parseFloat(value) || 100);
    };
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  return radius;
}

function MemberRing({ members, revealed }: { members: { funded: boolean }[]; revealed: boolean }) {
  const radius = useRingRadius();
  const fundedCount = members.filter((m) => m.funded).length;

  // Build a concise, dynamic summary for assistive technology.
  const ringLabel = revealed
    ? `${members.length}-member circle — pot claimed. Payout recipient is unlinkable to any member.`
    : `${members.length}-member circle, ${fundedCount} of ${members.length} funded, pot not yet claimed.`;

  // id used to associate the post-claim caption with the figure via
  // aria-describedby so VoiceOver reads it as supplementary description.
  const captionId = "ring-caption";

  return (
    <div className="ring-wrap">
      {/*
        role="img" turns the whole ring into a single AT object described by
        aria-label; aria-describedby wires up the visible caption when present.
        All child nodes are aria-hidden — the label already covers their state.
      */}
      <div
        className="ring"
        role="img"
        aria-label={ringLabel}
        {...(revealed ? { "aria-describedby": captionId } : {})}
      >
        <div className="ring-center" aria-hidden="true">
          {revealed ? "✓" : "pot"}
        </div>
        {members.map((m, i) => {
          const angle = (i / members.length) * 2 * Math.PI - Math.PI / 2;
          const x = Math.round(Math.cos(angle) * radius);
          const y = Math.round(Math.sin(angle) * radius);
          return (
            <div
              key={i}
              aria-hidden="true"
              className={`ring-node ${m.funded ? "funded" : ""}`}
              style={{ transform: `translate(${x}px, ${y}px)` }}
            >
              {i + 1}
            </div>
          );
        })}
        {revealed && (
          <div
            aria-hidden="true"
            className="ring-node ring-recipient"
            style={{ transform: "translate(0px, -170px)" }}
          >
            ?
          </div>
        )}
      </div>
      {revealed && (
        // id matches aria-describedby above; role="note" hints to AT that
        // this is supplementary information attached to the figure.
        <p id={captionId} role="note" className="ring-caption">
          Payout landed on the address above — cryptographically, it could be tied to <em>any</em>{" "}
          of the {members.length} members in the ring. An outside observer cannot tell which.
        </p>
      )}
    </div>
  );
}

function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, locales, setLocale, t } = useI18n();

  return (
    <div className={`language-switcher ${className ?? ""}`.trim()}>
      <label htmlFor="language-select">{t("lang.label")}</label>
      <select
        id="language-select"
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
        aria-label={t("lang.label")}
      >
        {locales.map((code) => (
          <option key={code} value={code}>
            {t(`lang.${code}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

function EnvSetupScreen({ errors }: { errors: string[] }) {
  const { t } = useI18n();

  return (
    <div className="page">
      <div className="card hero">
        <LanguageSwitcher className="language-switcher-hero" />
        <h1>SHARIBO</h1>
        <h2 style={{ color: "var(--color-error, #e55)" }}>{t("env.setupRequired")}</h2>
        <p className="sub">
          {t("env.setupIntro")} {t("env.setupHowTo")}
        </p>
        <ul style={{ textAlign: "left", margin: "1rem 0", padding: "0 1.25rem" }}>
          {errors.map((err) => (
            <li key={err} style={{ marginBottom: "0.5rem" }}>
              <code>{err}</code>
            </li>
          ))}
        </ul>
        <p className="fineprint">
          {t("env.setupDetails")}
        </p>
      </div>
    </div>
  );
}

function ClaimExplainer() {
  return (
    <details className="claim-explainer">
      <summary>How this claim proof works</summary>
      <div className="claim-explainer-body">
        <section>
          <h3>What the proof is saying</h3>
          <p>
            It proves the claimant knows a secret identity that is in this circle&apos;s Merkle root,
            and binds that proof to this exact circle and round via the round tag
            (<code>external_nullifier</code>).
          </p>
        </section>

        <section>
          <h3>What stays secret</h3>
          <p>
            Which member generated the proof stays private. The transaction proves valid membership
            without revealing which one of the 5 members claimed.
          </p>
        </section>

        <section>
          <h3>What the contract checks (in order)</h3>
          <ol>
            <li>The round is fully funded: pot equals contribution × size.</li>
            <li>The round tag matches this exact circle and round.</li>
            <li>This nullifier has never claimed before in this circle.</li>
            <li>The Groth16 proof verifies against the circle&apos;s committed root.</li>
          </ol>
        </section>

        <section>
          <h3>What observers can see</h3>
          <p>
            On-chain observers see 5 deposits in and 1 payout out, but no visible link from that
            payout address to a specific member address.
          </p>
        </section>
      </div>
    </details>
  );
}

export default function App() {
  const { t } = useI18n();

  if (configError.length > 0) {
    return <EnvSetupScreen errors={configError} />;
  }

  const [screen, setScreen] = useState<"landing" | "circle">("landing");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [contributionXlm, setContributionXlm] = useState(10);
  const [admin, setAdmin] = useState<Keypair | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tree, setTree] = useState<MerkleTree | null>(null);
  const [circleId, setCircleId] = useState<bigint | null>(null);
  const [hasFreighter, setHasFreighter] = useState(false);

  useEffect(() => {
    isConnected().then((res) => setHasFreighter(res.isConnected)).catch(() => setHasFreighter(false));
  }, []);
  const [round, setRound] = useState(0);
  const [pot, setPot] = useState(0n);
  const [claimantIndex, setClaimantIndex] = useState(0);
  const [proof, setProof] = useState<ContractProof | null>(null);
  const [nullifierHash, setNullifierHash] = useState<bigint | null>(null);
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);
  const [isProving, setIsProving] = useState(false);
  const [provingElapsedMs, setProvingElapsedMs] = useState<number | null>(null);
  const [nullifierClaimed, setNullifierClaimed] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const [claimStage, setClaimStage] = useState<ClaimStage | null>(null);
  const [proveElapsedSeconds, setProveElapsedSeconds] = useState(0);
  // Survives a reset so the landing screen can point back at the circle you
  // just left — it keeps living on-chain even though the UI has moved on.
  const [previousCircleId, setPreviousCircleId] = useState<bigint | null>(null);

  const [resumePrompt, setResumePrompt] = useState<any>(null);

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

  const [prevCircle, setPrevCircle] = useState<{ id: string; explorerUrl: string } | null>(null);

  const contribution = BigInt(contributionXlm) * STROOPS_PER_XLM;
  const fundedCount = members.filter((m) => m.funded).length;
  const fullyFunded = pot === contribution * BigInt(CIRCLE_SIZE);
  const { announce, message: liveRegionMessage } = usePoliteLiveRegion(120);

  useEffect(() => {
    if (busy) {
      announce(`Help: ${busy}`);
      return;
    }

    if (claimResult) {
      announce("Price update complete. The claim result is ready.");
      return;
    }

    if (error) {
      announce(`Error: ${error}`);
      return;
    }

    if (fullyFunded) {
      announce("Price update complete. The claim step is ready.");
    }
  }, [announce, busy, claimResult, error, fullyFunded]);

  // ── Focus management ────────────────────────────────────────────────────
  // When a screen or major section appears, move keyboard focus to its
  // heading (tabIndex={-1} makes non-interactive elements programmatically
  // focusable without inserting them into the Tab order).

  // 1. landing → circle: focus the circle card's "SHARIBO" h1
  const circleHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (screen === "circle") {
      circleHeadingRef.current?.focus();
    }
  }, [screen]);

  // 2. Fully funded → Claim section appears: focus "Claim" h2
  const claimHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (fullyFunded && !claimResult) {
      claimHeadingRef.current?.focus();
    }
    // Only trigger when fullyFunded flips to true; ignore claimResult changes here.
  }, [fullyFunded, claimResult]);

  // 3. Claim succeeds → Payout section appears: focus "Payout landed" h2
  const payoutHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (claimResult) {
      payoutHeadingRef.current?.focus();
    }
  }, [claimResult]);
  // ────────────────────────────────────────────────────────────────────────

  // Every hook above must run on every render, so this check — which used to
  // sit at the top of the component and return before any hooks ran — moved
  // here instead. configError is computed once at module load, so this still
  // reliably short-circuits into the setup screen; it just no longer skips
  // hook calls to do it.
  if (configError.length > 0) {
    return <EnvSetupScreen errors={configError} />;
  }

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
    sessionStorage.removeItem("sharibo_demo_state");

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
    setIsProving(false);
    setProvingElapsedMs(null);
    setNullifierClaimed(false);
    setRejection(null);
    setClaimStage(null);
    setProveElapsedSeconds(0);
    setScreen("landing");
  }

  function loadState(parsed: any) {
    setContributionXlm(parsed.contributionXlm);
    setAdmin(Keypair.fromSecret(parsed.adminSecret));
    
    const loadedMembers = parsed.members.map((m: any) => ({
      keypair: Keypair.fromSecret(m.secret),
      identity: m.identity,
      funded: m.funded,
      fundHash: m.fundHash,
    }));
    setMembers(loadedMembers);
    
    const newTree = MerkleTree.create(
      LEVELS,
      loadedMembers.map((m: any) => m.identity.commitment)
    );
    setTree(newTree);

    setCircleId(parsed.circleId);
    setRound(parsed.round);
    setPot(parsed.pot);
    setClaimantIndex(parsed.claimantIndex);
    setProof(parsed.proof);
    setNullifierHash(parsed.nullifierHash);
    setClaimResult(parsed.claimResult);
    setRejection(parsed.rejection);
    
    setScreen("circle");
    setResumePrompt(null);
  }

  async function startCircle() {
    setError(null);
    setBusy(
      "Generating a fresh admin + 5 member identities and funding via friendbot…",
    );
    try {
      const [{ Keypair }, client] = await Promise.all([
        import("@stellar/stellar-sdk"),
        import("@sharibo/client")
      ]);
      const { generateIdentity, MerkleTree, verificationKeyToContractFormat, connect, createCircle } = client;

      setBusy("Generating a fresh admin + 5 member identities and funding via friendbot…");
      const adminKp = Keypair.random();
      await fundWithFriendbot(adminKp.publicKey());

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
      const vkJson = await fetch("/circuits/verification_key.json").then((r) =>
        r.json(),
      );
      const vk = verificationKeyToContractFormat(vkJson);
      const adminClient = await connect(NETWORK, adminKp);
      const { result: newCircleId } = await createCircle(adminClient, {
        admin: adminKp.publicKey(),
        token: TOKEN,
        root: newTree.root,
        contribution,
        size: CIRCLE_SIZE,
        vk,
      });

      setAdmin(adminKp);
      setMembers(newMembers);
      setTree(newTree);
      setCircleId(newCircleId);
      setRound(0);
      setPot(0n);
      setScreen("circle");
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setBusy(null);
    }
  }

  async function fundMember(i: number) {
    if (!admin || circleId === null) return;
    setError(null);
    setBusy(`Funding from member ${i + 1}…`);
    try {
      const [{ Keypair }, { connect, fund, getCircle }] = await Promise.all([
        import("@stellar/stellar-sdk"),
        import("@sharibo/client")
      ]);
      const m = members[i];
      await fundWithFriendbot(m.keypair.publicKey());
      const memberClient = await connect(NETWORK, m.keypair);
      const { hash } = await fund(memberClient, {
        circleId,
        from: m.keypair.publicKey(),
      });
      setMembers((prev) =>
        prev.map((mm, idx) =>
          idx === i ? { ...mm, funded: true, fundHash: hash } : mm,
        ),
      );
      const adminClient = await connect(NETWORK, admin);
      const circle = await getCircle(adminClient, circleId);
      setPot(circle.pot);
      setRound(circle.round);
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setBusy(null);
    }
  }

  async function fundWithFreighter(i: number) {
    if (!admin || circleId === null) return;
    setError(null);
    setBusy(`Funding from member ${i + 1} via Freighter…`);
    try {
      const allowedRes = await isAllowed();
      if (!allowedRes.isAllowed) {
        await requestAccess();
      }

      const networkRes = await getNetworkDetails();
      if (networkRes.network !== "TESTNET") {
        throw new Error("Freighter is not set to Testnet. Please switch your network in Freighter.");
      }

      const addressRes = await getAddress();
      const pubKey = addressRes.address;
      if (!pubKey) {
        throw new Error("Could not get address from Freighter.");
      }
      
      const freighterSigner = {
        publicKey: pubKey,
        signTransaction: async (txXdr: string, opts?: { networkPassphrase: string } ) => {
          const signedRes = await freighterSignTx(txXdr, {
            networkPassphrase: networkRes.networkPassphrase
          });
          if (signedRes.error) {
            throw new Error(signedRes.error.toString());
          }
          return signedRes.signedTxXdr;
        }
      };

      const memberClient = await connect(NETWORK, freighterSigner);
      const { hash } = await fund(memberClient, {
        circleId,
        from: pubKey,
      });

      setMembers((prev) =>
        prev.map((mm, idx) => (idx === i ? { ...mm, funded: true, fundHash: hash, freighterKey: pubKey } : mm)),
      );

      const adminClient = await connect(NETWORK, admin);
      const circle = await getCircle(adminClient, circleId);
      setPot(circle.pot);
      setRound(circle.round);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function doClaim() {
    if (!admin || !tree || circleId === null) return;
    setError(null);
    setClaimResult(null);
    setRejection(null);
    setBusy("Claiming…");
    try {
      const [{ Keypair }, { computeExternalNullifier, generateProof, verifyProofLocally, connect, claim, getCircle }] = await Promise.all([
        import("@stellar/stellar-sdk"),
        import("@sharibo/client")
      ]);
      const claimant = members[claimantIndex];
      const merkleProof = tree.proof(claimantIndex);
      const externalNullifier = await computeExternalNullifier(circleId, BigInt(round));

      setClaimStage("artifacts");
      const [wasm, zkey, vkJson] = await Promise.all([
        fetch("/circuits/membership.wasm")
          .then((r) => r.arrayBuffer())
          .then((b) => new Uint8Array(b)),
        fetch("/circuits/membership_final.zkey")
          .then((r) => r.arrayBuffer())
          .then((b) => new Uint8Array(b)),
        fetch("/circuits/verification_key.json").then((r) => r.json()),
      ]);

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
      const recipient = Keypair.random();
      await fundWithFriendbot(recipient.publicKey());

      setClaimStage("submitting");
      const adminClient = await connect(NETWORK, admin);
      const { hash } = await claim(adminClient, {
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
        proofDurationMs: generated.provingTimeMs,
        verifyTimeMs,
      });
      setNullifierClaimed(await hasClaimed(adminClient, circleId, generated.nullifierHash));

      const circle = await getCircle(adminClient, circleId);
      setPot(circle.pot);
      setRound(circle.round);
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setBusy(null);
      setClaimStage(null);
    }
  }

  async function claimAgain() {
    if (!admin || circleId === null || !proof || nullifierHash === null) return;
    setError(null);
    setRejection(null);
    setBusy(
      "Refunding a new round, then replaying the same proof's nullifier…",
    );
    try {
      const [{ Keypair }, { connect, fund, computeExternalNullifier, claim, getCircle }] = await Promise.all([
        import("@stellar/stellar-sdk"),
        import("@sharibo/client")
      ]);
      // Fund round `round` again so this exercises the nullifier-reuse
      // check specifically, not just "the pot is empty" — the same
      // proof's nullifier gets rejected even against a fresh, funded round.
      const adminClient = await connect(NETWORK, admin);
      for (const m of members) {
        const memberClient = await connect(NETWORK, m.keypair);
        await fund(memberClient, { circleId, from: m.keypair.publicKey() });
      }
      const freshExternalNullifier = await computeExternalNullifier(
        circleId,
        BigInt(round),
      );

      setBusy("Replaying the used nullifier…");
      await claim(adminClient, {
        circleId,
        recipient: Keypair.random().publicKey(),
        nullifierHash,
        externalNullifier: freshExternalNullifier,
        proof,
      });
      setRejection(
        "Unexpected: the replayed claim was accepted (this should never happen).",
      );
    } catch (e) {
      setRejection(getErrorMessage(e));
    } finally {
      // Reflect the on-chain state either way: the re-funding above happened
      // for real even though the replayed claim itself was rejected.
      try {
        const { connect, getCircle } = await import("@sharibo/client");
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

  if (resumePrompt && screen === "landing") {
    return (
      <div className="page">
        <div className="card hero">
          <h1>Resume Circle #{resumePrompt.circleId.toString()}?</h1>
          <p className="sub">
            It looks like you refreshed the page while a circle was active. Do you want to resume?
          </p>
          <div className="row" style={{ marginTop: '2rem', justifyContent: 'center', gap: '1rem' }}>
            <button className="btn btn-primary" onClick={() => loadState(resumePrompt)}>
              Resume Circle
            </button>
            <button className="btn btn-danger" onClick={() => {
              sessionStorage.removeItem("sharibo_demo_state");
              setResumePrompt(null);
            }}>
              Discard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "landing") {
    return (
      <div className="page">
        <NetworkBanner />
        <div className="card hero">
          <LanguageSwitcher className="language-switcher-hero" />
          <div className="namewall">
            {NAMES.map((n) => (
              <span key={n} className="namewall-item">
                {n}
              </span>
            ))}
          </div>
          <h1>SHARIBO</h1>
          <p className="tagline">
            A private rotating savings circle — on Stellar, with real
            zero-knowledge proofs.
          </p>
          <p className="sub">
            Every round, everyone contributes. Every round, one member takes the
            pot. Sharibo proves <em>who's entitled to claim</em> without ever
            revealing <em>who</em> claimed.
          </p>
          <button
            className="btn btn-primary"
            disabled={!!busy}
            onClick={startCircle}
          >
            {busy ?? "Launch a 5-member circle on testnet"}
          </button>
          {error && <p className="error">{error}</p>}
          {previousCircleId !== null && (
            <p className="fineprint">
              Your previous circle lives on at{" "}
              <a
                className="link"
                href={explorerContract()}
                target="_blank"
                rel="noreferrer"
              >
                circle #{previousCircleId.toString()} ↗
              </a>
            </p>
          )}
          <p className="fineprint">
            Testnet only. Demo identities are generated fresh in your browser,
            never reused.
          </p>
          {prevCircle && (
            <p className="fineprint">
              Your previous circle #{prevCircle.id} lives on-chain —{" "}
              <a className="link" href={prevCircle.explorerUrl} target="_blank" rel="noreferrer">
                view on explorer ↗
              </a>
            </p>
          )}
        </div>
      </div>
    );
  }

  const step: 0 | 1 | 2 | 3 = flow.claimResult ? 3 : flow.fullyFunded ? 2 : 1;

  return (
    <div className="page">
      <NetworkBanner />
      <div className="card">
        <LanguageSwitcher />
        {/*
          Persistent live region — always in the DOM so the browser registers
          it before any text lands inside it (a common AT pitfall).
          aria-live="polite" lets the current reading finish first; "assertive"
          would interrupt mid-sentence which would be rude for long proof steps.
          aria-atomic="true" replaces the whole message on each update rather
          than diffing individual text nodes, which is more reliable across ATs.
        */}
        <LiveRegion message={liveRegionMessage} />
        <div className="row space-between">
          <h1 className="small" ref={circleHeadingRef} tabIndex={-1}>
            SHARIBO
          </h1>
          <div className="row">
            <a className="link" href={explorerContract()} target="_blank" rel="noreferrer">
              circle #{flow.circleId?.toString()} on-chain ↗
            </a>
            <button
              className="btn btn-small"
              disabled={!!flow.busy}
              onClick={flow.resetToLanding}
              title={`Start over. Your current circle (#${flow.circleId?.toString()}) keeps living on-chain.`}
            >
              {t("common.startNewCircle")}
            </button>
          </div>
        </div>

        <Stepper step={step} />

        <MemberRing members={flow.members} revealed={!!flow.claimResult} />

        <div className="pot-bar-wrap">
          <div
            className="pot-bar"
            style={{ width: `${(flow.fundedCount / CIRCLE_SIZE) * 100}%` }}
          />
        </div>
        <p className="pot-label">
          pot: {(Number(flow.pot) / 1e7).toFixed(1)} / {flow.contributionXlm * CIRCLE_SIZE} XLM ·
          round {flow.round}
        </p>

        <h2>Fund</h2>
        <p className="token-notice">
          Token:{" "}
          <a
            className="link"
            href={`https://stellar.expert/explorer/testnet/contract/${TOKEN}`}
            target="_blank"
            rel="noreferrer"
            title="Verify this token contract before funding"
          >
            <code>{TOKEN.slice(0, 6)}…{TOKEN.slice(-4)}</code> ↗
          </a>{" "}
          <CopyButton value={TOKEN} label="token contract address" />
          <span className="token-notice-tip"> — verify this address before funding</span>
        </p>
        <div className="members">
          {members.map((m, i) => (
            <div key={i} className={`member ${m.funded ? "funded" : ""}`}>
              <span className="member-addr">
                member {i + 1} · {short(m.keypair.publicKey())}
                <CopyButton value={m.keypair.publicKey()} label={`member ${i + 1} address`} />
              </span>
              {m.funded ? (
                <a
                  className="link"
                  href={explorerTx(m.fundHash!)}
                  target="_blank"
                  rel="noreferrer"
                >
                  ✓ funded ↗
                </a>
              ) : (
                <div className="row">
                  <button
                    className="btn btn-small"
                    disabled={!!busy || round > 0}
                    onClick={() => fundMember(i)}
                  >
                    Fund {contributionXlm} XLM (Demo)
                  </button>
                  {hasFreighter && (
                    <button
                      className="btn btn-small"
                      disabled={!!busy || round > 0}
                      onClick={() => fundWithFreighter(i)}
                    >
                      Fund with Freighter
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {fullyFunded && !claimResult && (
          <>
            <h2 ref={claimHeadingRef} tabIndex={-1}>
              Claim
            </h2>
            <p className="sub">
              Pick which member is claiming this round — the proof will show the
              contract that they're a real member <em>without</em> revealing
              which one.
            </p>
            <div className="row">
              {members.map((_, i) => (
                <label key={i} className="radio">
                  <input
                    type="radio"
                    checked={claimantIndex === i}
                    onChange={() => setClaimantIndex(i)}
                    disabled={!!busy}
                  />
                  member {i + 1}
                </label>
              ))}
            </div>
            <button className="btn btn-primary" disabled={!!busy} onClick={doClaim}>
              {claimStage ? CLAIM_STAGE_LABELS[claimStage] : "Generate proof & claim"}
            </button>
            <ClaimExplainer />
            {busy && (
              <p className="techline">
                {/* Constraint count: update this AND circuits/README.md if the circuit changes. */}
                Groth16 · BLS12-381 · 1,452 constraints · proving locally in your browser, nothing
                sent anywhere until the proof is done
                {isProving && provingSeconds !== null ? ` · proving… ${provingSeconds}s` : ""}
              </p>
            )}
          </>
        )}

        {claimResult && (
          <div className="result">
            <h2 ref={payoutHeadingRef} tabIndex={-1}>
              Payout landed
            </h2>
            <p>
              Fresh recipient <code>{short(claimResult.recipient)}</code>
              <CopyButton value={claimResult.recipient} label="recipient address" />{" "}
              <a href={explorerAccount(claimResult.recipient)} target="_blank" rel="noreferrer">
                ↗
              </a>{" "}
              received the pot. It has never appeared anywhere else on this
              circle.
            </p>
            <a
              className="link"
              href={explorerTx(claimResult.hash)}
              target="_blank"
              rel="noreferrer"
            >
              view claim transaction ↗
            </a>
            <CopyButton value={claimResult.hash} label="claim transaction hash" />
            <p className="callout">
              Compare the 5 funding transactions above to this claim — same
              contract, no shared address, no visible link.
            </p>
            <p className="techline">
              proof generated in {(claimResult.proofDurationMs / 1000).toFixed(1)}s ·
              local verify {claimResult.verifyTimeMs.toFixed(0)}ms ✓
            </p>
            <button
              className="btn btn-danger"
              disabled={!!busy || (!!rejection && nullifierClaimed)}
              onClick={claimAgain}
              title={
                rejection && nullifierClaimed
                  ? "Nullifier already claimed (has_claimed)"
                  : undefined
              }
            >
              {busy ?? "Try to claim again with the same proof"}
            </button>
            {nullifierClaimed && !rejection && (
              <p className="callout">
                <code>has_claimed</code> is true for this nullifier — a replay will be rejected
                on-chain.
              </p>
            )}
            {rejection && (
              <>
                <div className="rejected">
                  <strong>Rejected on-chain:</strong> {rejection}
                </div>
                <button
                  className="btn btn-primary"
                  disabled={!!busy}
                  onClick={resetToLanding}
                >
                  Start a new circle
                </button>
              </>
            )}
            {rejection && (
              <div className="new-circle-cta">
                <button
                  className="btn btn-primary"
                  disabled={!!busy}
                  onClick={resetToLanding}
                >
                  ↺ Start a new circle
                </button>
                <p className="fineprint">
                  Circle #{circleId?.toString()} stays on-chain forever —{" "}
                  <a className="link" href={explorerContract()} target="_blank" rel="noreferrer">
                    view on explorer ↗
                  </a>
                  . Starting a new circle generates fresh identities and a brand-new on-chain record.
                </p>
              </div>
            )}
          </div>
        )}

        {flow.error && <p className="error">{flow.error}</p>}
      </div>
    </div>
  );
}

function getErrorMessage(error: unknown): string {
  return toUiError(error);
}