import { useState, useRef, useEffect, useCallback } from "react";
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
  connectReadOnly,
  createCircle,
  fund,
  claim,
  cancelCircle,
  getCircle,
  hasClaimed,
  TREE_LEVELS,
  xlmToStroops,
  formatXlm,
  type Identity,
  type ContractProof,
  type CircleId,
  makeCircleId,
  ContractError,
  CircleNotFoundError,
  RoundNotFundedError,
  WrongRoundTagError,
  AlreadyClaimedError,
  InvalidProofError,
  RoundFullError,
  OverflowError,
  CircleCancelledError,
  RpcError,
  ProvingError,
  InvalidInputError,
  describeError,
  networkOf,
} from "@sharibo/client";
import { config, configError } from "./config";
import { useI18n } from "./i18n";
import { usePoliteLiveRegion } from "./usePoliteLiveRegion";
import { ArtifactProgress } from "./components/ArtifactProgress.js";
import { explorerTx, short, explorerAccount, explorerContract } from "./lib/explorer";
import type { CirclePhase } from "./hooks/useCircleFlow";
import { MemberRingSkeleton } from "./components/MemberRing";
import { FundingListSkeleton } from "./components/FundingList";
import {
  friendbotFund as fundWithFriendbot,
  FriendbotRetryableError,
  FRIEND_BOT_RATE_LIMIT_MESSAGE,
} from "./lib/friendbot";
import styles from "./App.module.css";
import { checkNetworkMatch } from "./lib/wallet.freighter";
import { Toaster } from "./components/Toaster";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { diagnose, type Failure } from "./state/circleMachine";
import { copyDebugBundle, type BundleInput } from "./lib/debugBundle";

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

// `config` is null when config validation failed (see config.ts); the component
// below gates on `configError.length > 0` and renders the setup screen, so these
// module-level values are only ever used on the happy path. Optional chaining
// keeps importing this module from crashing on a misconfigured build.
const NETWORK = {
  contractId: config?.contractId ?? "",
  rpcUrl: config?.rpcUrl ?? "",
  networkPassphrase: config?.networkPassphrase ?? "",
};
const TOKEN = config?.testTokenContractId ?? "";
const LEVELS = TREE_LEVELS;
const CIRCLE_SIZE = 5;
const README_URL = "https://github.com/crackedstudio/sharibo#honest-limitations";

const isTestnet = networkOf(NETWORK.networkPassphrase) === "testnet";
const BANNER_TEXT = isTestnet ? "Stellar testnet — no real funds" : "";

function TestnetBanner() {
  const { t } = useI18n();
  if (!isTestnet) return null;
  return (
    <div className={styles.testnetBanner}>
      <span>{BANNER_TEXT}</span>
      <a className={styles.bannerLink} href={README_URL} target="_blank" rel="noreferrer">
        honest limitations ↗
      </a>
    </div>
  );
}

function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, locales, setLocale } = useI18n();
  return (
    <div className={`language-switcher ${className}`}>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
        aria-label="Language"
      >
        {locales.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
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

function toUiError(error: unknown, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (error instanceof FriendbotRetryableError) {
    return FRIEND_BOT_RATE_LIMIT_MESSAGE;
  }

  // Typed contract-error subclasses — no XDR string matching needed.
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


// Every truncated value on screen (addresses, tx hashes) needs to be
// pasteable in full somewhere else — a CLI call, an explorer search — so
// this pairs with each `short(...)` display. Falls back to a prompt() (which
// itself is trivially copyable) when the async Clipboard API isn't
// available, e.g. non-secure contexts.
function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const tmr = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(tmr);
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
      className={styles.copyBtn}
      onClick={handleCopy}
      aria-label={t("copy.aria", { label })}
      title={t("copy.title", { label })}
    >
      {copied ? "✓" : "📋"}
    </button>
  );
}

// Injected at build time by Vite; falls back to "dev" in local dev.
const APP_VERSION: string =
  (typeof import.meta.env.VITE_APP_VERSION === "string"
    ? import.meta.env.VITE_APP_VERSION
    : undefined) ?? "dev";

const BUG_REPORT_URL =
  "https://github.com/crackedstudio/sharibo/issues/new?template=bug_report.yml";

/**
 * Collects the current circle-flow state into a DebugBundle and copies it as
 * formatted markdown to the clipboard. Placed in the footer of the circle
 * screen and next to any error message so a user can grab it whenever
 * something goes wrong.
 *
 * Secret keys are never included — see app/src/lib/debugBundle.ts for the
 * allow-list and the defence-in-depth regex backstop.
 */
function CopyDebugBundleButton({
  circleId,
  round,
  currentStep,
  lastError,
  fundedCount,
  circleSize,
  pot,
  timings,
}: {
  circleId: bigint | null;
  round: number;
  currentStep: string | null;
  lastError: string | null;
  fundedCount: number;
  circleSize: number;
  pot: bigint;
  timings: Record<string, number>;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "fallback" | "error">("idle");

  useEffect(() => {
    if (status === "idle") return;
    const t = setTimeout(() => setStatus("idle"), 2500);
    return () => clearTimeout(t);
  }, [status]);

  async function handleClick() {
    const input: BundleInput = {
      appVersion: APP_VERSION,
      network: {
        contractId: config.contractId,
        rpcUrl: config.rpcUrl,
        networkPassphrase: config.networkPassphrase,
        tokenContractId: config.testTokenContractId,
      },
      circleId,
      round,
      currentStep,
      lastError,
      fundedCount,
      circleSize,
      pot,
      // Artifact hashes are not tracked in the App's state yet; omit rather
      // than leave undefined — the bundle accepts an empty record.
      artifactHashes: {},
      timings,
      userAgent: navigator.userAgent,
    };

    const result = await copyDebugBundle(input);
    if (result.ok) {
      setStatus("copied");
    } else if (result.markdown) {
      // Clipboard API blocked but we have the markdown — show it via prompt().
      window.prompt(
        "Clipboard unavailable. Select all and copy manually, then paste into your bug report:",
        result.markdown,
      );
      setStatus("fallback");
    } else {
      setStatus("error");
    }
  }

  const label =
    status === "copied"
      ? "✓ Copied!"
      : status === "fallback"
        ? "Opened prompt"
        : status === "error"
          ? "Error — retry?"
          : "📋 Copy debug bundle";

  return (
    <span className="debug-bundle-wrap">
      <button
        type="button"
        className="btn btn-ghost btn-small"
        onClick={handleClick}
        title="Copy a redacted debug snapshot to your clipboard, ready to paste into a bug report. No secret keys are included."
      >
        {label}
      </button>
      {(status === "copied" || status === "fallback") && (
        <a
          className="link fineprint"
          href={BUG_REPORT_URL}
          target="_blank"
          rel="noreferrer"
        >
          open bug report ↗
        </a>
      )}
    </span>
  );
}

interface Member {
  keypair: Keypair;
  identity: Identity;
  funded: boolean;
  fundHash?: string;
  freighterKey?: string;
  ineligible?: boolean;
  ineligibleReason?: string;
  pending?: boolean; // Optimistic flag while transaction is in flight
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
// Defined in ./types.ts so ClaimSection can share it without importing App.
import type { ClaimStage } from "./types.js";

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
  const { t } = useI18n();
  const activeIndex = CLAIM_STAGES.indexOf(stage);
  const stageLabels: Record<ClaimStage, string> = {
    artifacts: t("claim.stage.artifacts"),
    proving: t("claim.stage.proving"),
    verifying: t("claim.stage.verifying"),
    funding: t("claim.stage.funding"),
    submitting: t("claim.stage.submitting"),
  };
  return (
    <div className={styles.claimProgress}>
      <div className={styles.stepper}>
        {CLAIM_STAGES.map((s, i) => (
          <div
            key={s}
            className={`${styles.step} ${i < activeIndex ? styles.done : i === activeIndex ? styles.active : ""}`}
          >
            <span className={styles.stepDot}>{i < activeIndex ? "✓" : i + 1}</span>
            {CLAIM_STAGE_LABELS[s]}
          </div>
        ))}
      </div>
      {stage === "proving" && (
        <p className={styles.techline}>
          <span className={styles.spinner} aria-hidden="true" /> Groth16 · BLS12-381 · 1,452 constraints ·
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
      <ol className={styles.stepper} style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {labels.map((label, i) => {
          const state = i < step ? "done" : i === step ? "active" : "";
          return (
            <li
              key={label}
              className={`${styles.step} ${state}`}
              // aria-current="step" marks the single active step; completed
              // and upcoming steps get no aria-current attribute at all.
              {...(i === step ? { "aria-current": "step" as const } : {})}
            >
              {/* The dot (✓ / number) is decorative — the li text already
                  conveys position, so hide the dot from the AT tree. */}
              <span className={styles.stepDot} aria-hidden="true">
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
  const { t } = useI18n();
  const isTestnet = networkOf(NETWORK.networkPassphrase) !== "mainnet";
  if (!isTestnet) return null;
  return (
    <div className={styles.networkBanner}>
      Stellar testnet — no real funds ·{" "}
      <a
        href="https://github.com/glorious21-coder/sharibo#honest-limitations"
        target="_blank"
        rel="noreferrer"
      >
        {t("banner.limitationsShort")}
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

function MemberRing({ members, revealed }: { members: { funded: boolean; pending?: boolean }[]; revealed: boolean }) {
  const { t } = useI18n();
  const radius = useRingRadius();
  const fundedCount = members.filter((m) => m.funded).length;

  const ringLabel = revealed
    ? t("ring.label.revealed", { count: members.length })
    : t("ring.label.loading", { count: members.length, funded: fundedCount });

  const captionId = "ring-caption";

  return (
    <div className={styles.ringWrap}>
      <div
        className={styles.ring}
        role="img"
        aria-label={ringLabel}
        {...(revealed ? { "aria-describedby": captionId } : {})}
      >
        <div className={styles.ringCenter} aria-hidden="true">
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
              className={`ring-node ${m.funded ? "funded" : ""} ${m.pending ? "pending" : ""}`}
              style={{ transform: `translate(${x}px, ${y}px)` }}
            >
              {i + 1}
            </div>
          );
        })}
        {revealed && (
          <div
            aria-hidden="true"
            className={`${styles.ringNode} ${styles.ringRecipient}`}
            style={{ transform: "translate(0px, -170px)" }}
          >
            ?
          </div>
        )}
      </div>
      {revealed && (
        <p id={captionId} role="note" className={styles.ringCaption}>
          Payout landed on the address above — cryptographically, it could be tied to <em>any</em>{" "}
          of the {members.length} members in the ring. An outside observer cannot tell which.
        </p>
      )}
    </div>
  );
}

function EnvSetupScreen({ errors }: { errors: string[] }) {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <div className={`${styles.card} ${styles.hero}`}>
        <LanguageSwitcher className={styles.languageSwitcherHero} />
        <h1>SHARIBO</h1>
        <h2 style={{ color: "var(--color-error, #e55)" }}>{t("env.setupRequired")}</h2>
        <p className={styles.sub}>
          {t("env.setupIntro")} {t("env.setupHowTo")}
        </p>
        <ul style={{ textAlign: "left", margin: "1rem 0", padding: "0 1.25rem" }}>
          {errors.map((err) => (
            <li key={err} style={{ marginBottom: "0.5rem" }}>
              <code>{err}</code>
            </li>
          ))}
        </ul>
        <p className={styles.fineprint}>
          {t("env.setupDetails")}
        </p>
      </div>
    </div>
  );
}

// ── Persistent live-region (must stay in DOM) ───────────────────────────────

function LiveRegion({ message }: { message: string }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}
    >
      {message}
    </div>
  );
}

// ── ClaimExplainer ──────────────────────────────────────────────────────────

function ClaimExplainer() {
  const { t } = useI18n();
  return (
    <details className={styles.claimExplainer}>
      <summary>How this claim proof works</summary>
      <div className={styles.claimExplainerBody}>
        <section>
          <h3>{t("explainer.sayingTitle")}</h3>
          <p>
            {t("explainer.sayingBody")}
          </p>
        </section>
        <section>
          <h3>{t("explainer.secretTitle")}</h3>
          <p>{t("explainer.secretBody")}</p>
        </section>
        <section>
          <h3>{t("explainer.checksTitle")}</h3>
          <ol>
            <li>{t("explainer.check1")}</li>
            <li>{t("explainer.check2")}</li>
            <li>{t("explainer.check3")}</li>
            <li>{t("explainer.check4")}</li>
          </ol>
        </section>
        <section>
          <h3>{t("explainer.observersTitle")}</h3>
          <p>{t("explainer.observersBody")}</p>
        </section>
      </div>
    </details>
  );
}

// ── Root component ───────────────────────────────────────────────────────────

export default function App() {
  const { t } = useI18n();
  const online = useOnlineStatus();
  const [failure, setFailure] = useState<Failure | null>(null);

  if (configError.length > 0) {
    return <EnvSetupScreen errors={configError} />;
  }

  const [screen, setScreen] = useState<"landing" | "circle">("landing");
  const [circlePhase, setCirclePhase] = useState<CirclePhase>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);

  const [contributionXlm, setContributionXlm] = useState(10);
  const [admin, setAdmin] = useState<Keypair | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tree, setTree] = useState<MerkleTree | null>(null);
  const [circleId, setCircleId] = useState<CircleId | null>(null);
  const [hasFreighter, setHasFreighter] = useState(false);

  useEffect(() => {
    isConnected().then((res) => setHasFreighter(res.isConnected)).catch(() => setHasFreighter(false));
  }, []);
  const [round, setRound] = useState(0);
  const [pot, setPot] = useState(0n);
  const [feeBps, setFeeBps] = useState(0);
  const [feeRecipient, setFeeRecipient] = useState("");
  const [onChainContributors, setOnChainContributors] = useState<string[]>([]);
  const [cancelled, setCancelled] = useState(false);
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
  // Step timings (ms) collected during doClaim for the debug bundle.
  const [stepTimings, setStepTimings] = useState<Record<string, number>>({});
  // Survives a reset so the landing screen can point back at the circle you
  // just left — it keeps living on-chain even though the UI has moved on.
  const [previousCircleId, setPreviousCircleId] = useState<CircleId | null>(null);

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

  const contribution = xlmToStroops(contributionXlm);
  // Holds the AbortController for the currently-running claim flow so that
  // resetToLanding and the unmount cleanup can cancel it synchronously.
  const claimAbortRef = useRef<AbortController | null>(null);

  // Abort any in-flight claim when the component unmounts (e.g. the user
  // navigates away mid-proof).  This prevents a stale setState from firing on
  // a dead component and triggering React's "Can't perform a React state
  // update on an unmounted component" warning.
  useEffect(() => {
    return () => {
      claimAbortRef.current?.abort();
    };
  }, []);
  const fundedCount = members.filter((m) => m.funded).length;
  const fullyFunded = pot === contribution * BigInt(CIRCLE_SIZE);
  const { announce, message: liveRegionMessage } = usePoliteLiveRegion(120);

  // Sync funding state from on-chain data
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
      
      // Update member funded status based on on-chain contributors
      setMembers((prev) =>
        prev.map((m) => {
          const hasFunded =
            circle.contributors.includes(m.keypair.publicKey()) ||
            Boolean(m.freighterKey && circle.contributors.includes(m.freighterKey));
          return { ...m, funded: hasFunded, pending: false };
        })
      );
    } catch (e) {
      console.error("Failed to sync funding state:", e);
    }
  }, [admin, circleId]);

  // Sync funding state when circleId changes or on mount
  useEffect(() => {
    if (circleId !== null && admin) {
      syncFundingState();
    }
  }, [circleId, admin, syncFundingState]);

  // Poll for third-party funding updates every 10 seconds when circle is active
  useEffect(() => {
    if (circleId !== null && admin && screen === "circle" && !claimResult) {
      const interval = setInterval(() => {
        syncFundingState();
      }, 10000); // Poll every 10 seconds
      return () => clearInterval(interval);
    }
  }, [circleId, admin, screen, claimResult, syncFundingState]);

  useEffect(() => {
    if (busy) {
      announce(t("liveRegion.help", { message: busy }));
      return;
    }

    if (circlePhase === "loading") {
      announce("Loading circle data…");
      return;
    }

    if (claimResult) {
      announce(t("liveRegion.claimResultReady"));
      return;
    }

    if (error) {
      announce(t("liveRegion.error", { message: error }));
      return;
    }

    if (fullyFunded) {
      announce(t("liveRegion.claimStepReady"));
    }
  }, [announce, busy, circlePhase, claimResult, error, fullyFunded]);

  // ── Focus management ────────────────────────────────────────────────────
  // When a screen or major section appears, move keyboard focus to its
  // heading (tabIndex={-1} makes non-interactive elements programmatically
  // focusable without inserting them into the Tab order).

  // 1. landing → circle: focus the circle card's "SHARIBO" h1
  const circleHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (screen === "circle") circleHeadingRef.current?.focus();
  }, [screen]);

  const claimHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (fullyFunded && !claimResult) {
      claimHeadingRef.current?.focus();
    }
    // Only trigger when fullyFunded flips to true; ignore claimResult changes here.
  }, [fullyFunded, claimResult]);

  const payoutHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (claimResult) {
      payoutHeadingRef.current?.focus();
    }
  }, [claimResult]);
  
  // When the claim step becomes available, pre-check each member's nullifier
  // against `has_claimed` so we can mark ineligible members immediately
  // (avoids generating a slow proof only to be rejected on-chain).
  useEffect(() => {
    let mounted = true;
    async function checkEligibility() {
      if (!fullyFunded || claimResult || !circleId || !admin) return;
      try {
        setBusy("Checking member eligibility…");
        const client = await import("@sharibo/client");
        const { computeExternalNullifier, computeNullifierHash, connect, hasClaimed } = client;
        const external = await computeExternalNullifier(circleId, BigInt(round));
        const adminClient = await connect(NETWORK, admin);
        const results = await Promise.all(
          members.map(async (m) => {
            const nullifier = computeNullifierHash(m.identity.identityNullifier, external);
            return await hasClaimed(adminClient, circleId, nullifier);
          }),
        );
        if (!mounted) return;
        setMembers((prev) => prev.map((m, i) => ({ ...m, ineligible: results[i], ineligibleReason: results[i] ? "Already claimed in this circle" : undefined })));
      } catch (e) {
        setError(toUiError(e, t));
      } finally {
        if (mounted) setBusy(null);
      }
    }
    checkEligibility();
    return () => { mounted = false; };
  }, [fullyFunded, claimResult, circleId, round, admin]);
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
      const ok = window.confirm(t("reset.confirm"));
      if (!ok) return;
    }

    // Cancel any in-flight proof generation / artifact download.
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

  function loadState(parsed: any) {
    setCirclePhase("loading");
    setContributionXlm(parsed.contributionXlm);
    setAdmin(Keypair.fromSecret(parsed.adminSecret));
    
    const loadedMembers = parsed.members.map((m: any) => ({
      keypair: Keypair.fromSecret(m.secret),
      identity: m.identity,
      funded: false, // Will be synced from on-chain
      fundHash: m.fundHash,
      ineligible: m.ineligible ?? false,
      pending: false,
    }));
    setMembers(loadedMembers);
    
    const newTree = MerkleTree.create(
      LEVELS,
      loadedMembers.map((m: any) => m.identity.commitment)
    );
    setTree(newTree);

    setCircleId(parsed.circleId);
    setRound(parsed.round);
    setPot(0n); // Will be synced from on-chain
    setClaimantIndex(parsed.claimantIndex);
    setProof(parsed.proof);
    setNullifierHash(parsed.nullifierHash);
    setClaimResult(parsed.claimResult);
    setRejection(parsed.rejection);
    
    setScreen("circle");
    setResumePrompt(null);
    
    // Sync from on-chain after loading state
    setTimeout(() => syncFundingState(), 100);
    setCirclePhase("ready");
  }

  async function startCircle() {
    setError(null);
    setCirclePhase("loading");
    setBusy(
      "Generating a fresh admin + 5 member identities and funding via friendbot…",
    );
    try {
      const [{ Keypair }, client] = await Promise.all([
        import("@stellar/stellar-sdk"),
        import("@sharibo/client")
      ]);
      const { generateIdentity, MerkleTree, verificationKeyToContractFormat, connect, createCircle } = client;

      setBusy(t("busy.generating"));
      const adminKp = Keypair.random();
      await fundWithFriendbot(adminKp.publicKey());

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

      setBusy(t("busy.creating"));
      const vkJson = await fetch("/circuits/verification_key.json").then((r) =>
        r.json(),
      );
      const vk = verificationKeyToContractFormat(vkJson);
      const adminClient = await connect({ ...NETWORK, onEvent: (e) => setEvents(prev => [...prev, e]) }, adminKp);
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
      const [{ Keypair }, { connect, fund }] = await Promise.all([
        import("@stellar/stellar-sdk"),
        import("@sharibo/client")
      ]);
      const m = members[i];
      await fundWithFriendbot(m.keypair.publicKey());
      
      // Set optimistic pending state
      setMembers((prev) =>
        prev.map((mm, idx) =>
          idx === i ? { ...mm, pending: true } : mm,
        ),
      );
      
      const memberClient = await connect(NETWORK, m.keypair);
      const { hash } = await fund(memberClient, {
        circleId,
        from: m.keypair.publicKey(),
      });
      
      // Sync with on-chain state after submission
      await syncFundingState();
      
      // Update fund hash for the successful transaction
      setMembers((prev) =>
        prev.map((mm, idx) =>
          idx === i ? { ...mm, fundHash: hash } : mm,
        ),
      );
    } catch (e) {
      // Clear pending state on error
      setMembers((prev) =>
        prev.map((mm, idx) =>
          idx === i ? { ...mm, pending: false } : mm,
        ),
      );
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
      
      // Check for network mismatch between wallet and app config
      const mismatch = checkNetworkMatch(networkRes.network, NETWORK.networkPassphrase);
      if (mismatch) {
        throw new Error(
          `Your Freighter wallet is connected to ${mismatch.walletNetwork}, ` +
          `but this app is configured for ${mismatch.appNetwork}. ` +
          `Please open Freighter, click the network selector in the upper right, and switch to ${mismatch.appNetwork}.`
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
        signTransaction: async (txXdr: string, opts?: any) => {
          // Re-check network before signing to catch mid-session network switches
          const currentNetworkRes = await getNetworkDetails();
          const currentMismatch = checkNetworkMatch(currentNetworkRes.network, NETWORK.networkPassphrase);
          if (currentMismatch) {
            throw new Error(
              `Your Freighter wallet is connected to ${currentMismatch.walletNetwork}, ` +
              `but this app is configured for ${currentMismatch.appNetwork}. ` +
              `Please open Freighter, click the network selector in the upper right, and switch to ${currentMismatch.appNetwork}.`
            );
          }

          const signedRes = await freighterSignTx(txXdr, {
            networkPassphrase: currentNetworkRes.networkPassphrase
          });
          if (signedRes.error) {
            throw new Error(signedRes.error.toString());
          }
          return signedRes.signedTxXdr;
        }
      };

      // Set optimistic pending state
      setMembers((prev) =>
        prev.map((mm, idx) =>
          idx === i ? { ...mm, pending: true } : mm,
        ),
      );

      const { connect, fund } = await import("@sharibo/client");
      const memberClient = await connect(NETWORK, freighterSigner);
      const { hash } = await fund(memberClient, {
        circleId,
        from: pubKey,
      });

      // Sync with on-chain state after submission
      await syncFundingState();
      
      // Update fund hash and freighter key for the successful transaction
      setMembers((prev) =>
        prev.map((mm, idx) => (idx === i ? { ...mm, fundHash: hash, freighterKey: pubKey } : mm)),
      );
    } catch (e) {
      // Clear pending state on error
      setMembers((prev) =>
        prev.map((mm, idx) =>
          idx === i ? { ...mm, pending: false } : mm,
        ),
      );
      setError(getErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function doClaim() {
    if (!admin || !tree || circleId === null) return;

    // Cancel any previous claim that might still be running.
    claimAbortRef.current?.abort();
    const controller = new AbortController();
    claimAbortRef.current = controller;
    const { signal } = controller;

    setError(null);
    setClaimResult(null);
    setRejection(null);
    setBusy(t("busy.claiming"));
    try {
      const [{ Keypair }, { computeExternalNullifier, generateProof, verifyProofLocally, connect, claim, getCircle, hasClaimed }] = await Promise.all([
        import("@stellar/stellar-sdk"),
        import("@sharibo/client")
      ]);

      if (signal.aborted) return;
      const claimant = members[claimantIndex];
      const merkleProof = tree.proof(claimantIndex);
      const externalNullifier = await computeExternalNullifier(circleId, BigInt(round));

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
          { signal, onEvent: (e) => setEvents((prev) => [...prev, e]) },
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

      if (signal.aborted) return;
      setClaimStage("submitting");
      const adminClient = await connect({ ...NETWORK, onEvent: (e) => setEvents(prev => [...prev, e]) }, admin);
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

      // Sync with on-chain state after claim
      await syncFundingState();
    } catch (e) {
      setError(toUiError(e, t));
    } finally {
      if (!signal.aborted) {
        setBusy(null);
        setClaimStage(null);
      }
      // Release the ref only if this controller is still the active one.
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
      const [{ Keypair }, { connect, fund, computeExternalNullifier, claim }] = await Promise.all([
        import("@stellar/stellar-sdk"),
        import("@sharibo/client")
      ]);
      // Fund round `round` again so this exercises the nullifier-reuse
      // check specifically, not just "the pot is empty" — the same
      // proof's nullifier gets rejected even against a fresh, funded round.
      const adminClient = await connect({ ...NETWORK, onEvent: (e) => setEvents(prev => [...prev, e]) }, admin);
      for (const m of members) {
        const memberClient = await connect({ ...NETWORK, onEvent: (e) => setEvents(prev => [...prev, e]) }, m.keypair);
        await fund(memberClient, { circleId, from: m.keypair.publicKey() });
      }
      const freshExternalNullifier = await computeExternalNullifier(
        circleId,
        BigInt(round),
      );

      setBusy(t("busy.replaying"));
      await claim(adminClient, {
        circleId,
        recipient: Keypair.random().publicKey(),
        nullifierHash,
        externalNullifier: freshExternalNullifier,
        proof,
      });
      setRejection(t("rejection.unexpected"));
    } catch (e) {
      setRejection(toUiError(e, t));
    } finally {
      // Reflect the on-chain state either way: the re-funding above happened
      // for real even though the replayed claim itself was rejected.
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
      t("cancel.confirmation", { count: refundCount, total: refundTotal })
    );
    
    if (!confirmed) return;
    
    setBusy(t("cancel.busy"));
    try {
      const { connect, cancelCircle } = await import("@sharibo/client");
      const adminClient = await connect(NETWORK, admin);
      await cancelCircle(adminClient, { circleId });
      
      // Sync with on-chain state after cancellation
      await syncFundingState();
    } catch (e) {
      setError(toUiError(e, t));
    } finally {
      setBusy(null);
    }
  }

  if (resumePrompt && screen === "landing") {
    return (
      <div className={styles.page}>
        <div className={`${styles.card} ${styles.hero}`}>
          <h1>Resume Circle #{resumePrompt.circleId.toString()}?</h1>
          <p className={styles.sub}>
            It looks like you refreshed the page while a circle was active. Do you want to resume?
          </p>
          <div className={styles.row} style={{ marginTop: '2rem', justifyContent: 'center', gap: '1rem' }}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => loadState(resumePrompt)}>
              Resume Circle
            </button>
            <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => {
              sessionStorage.removeItem("sharibo_demo_state");
              setResumePrompt(null);
            }}>
              {t("resume.discardButton")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "landing") {
    return (
      <div className={styles.page}>
        <NetworkBanner />
        {!online && (
          <div className="offline-banner" role="status">
            You are offline. Network actions are paused — reconnect to start or retry a circle.
          </div>
        )}
                <div className={`${styles.card} ${styles.hero}`}>
          <LanguageSwitcher className={styles.languageSwitcherHero} />
          <div className={styles.namewall}>
            {NAMES.map((n) => (
              <span key={n} className={styles.namewallItem}>
                {n}
              </span>
            ))}
          </div>
          <h1>SHARIBO</h1>
          <p className={styles.tagline}>
            A private rotating savings circle — on Stellar, with real
            zero-knowledge proofs.
          </p>
          <p className={styles.sub}>
            Every round, everyone contributes. Every round, one member takes the
            pot. Sharibo proves <em>who's entitled to claim</em> without ever
            revealing <em>who</em> claimed.
          </p>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!online || !!busy}
            onClick={startCircle}
          >
            {busy ?? t("landing.launch")}
          </button>
          {error && <p className={styles.error}>{error}</p>}
          <Toaster failure={failure} busy={!!busy} online={online} onDismiss={() => setFailure(null)} />
          {previousCircleId !== null && (
            <p className={styles.fineprint}>
              Your previous circle lives on at{" "}
              <a
                className={styles.link}
                href={explorerContract()}
                target="_blank"
                rel="noreferrer"
              >
                {t("landing.previousCircleLink", { id: previousCircleId.toString() })}
              </a>
            </p>
          )}
          <p className={styles.fineprint}>
            Testnet only. Demo identities are generated fresh in your browser,
            never reused.
          </p>
          {prevCircle && (
            <p className={styles.fineprint}>
              Your previous circle #{prevCircle.id} lives on-chain —{" "}
              <a className={styles.link} href={prevCircle.explorerUrl} target="_blank" rel="noreferrer">
                view on explorer ↗
              </a>
            </p>
          )}
        </div>
      </div>
    );
  }

  const step: 0 | 1 | 2 | 3 = claimResult ? 3 : fullyFunded ? 2 : 1;

  return (
    <div className={styles.page}>
      <NetworkBanner />
      <div className={styles.card}>
        <LanguageSwitcher />
        {/*
          Persistent live region — always in the DOM so the browser registers
          it before any text lands inside it (a common AT pitfall).
        */}
        <LiveRegion message={liveRegionMessage} />
        <ArtifactProgress announce={announce} />
        {!online && (
          <div className="offline-banner" role="status">
            You are offline. Network actions are paused — reconnect to fund, claim, or retry.
          </div>
        )}
        <div className="row space-between">
          <h1 className="small" ref={circleHeadingRef} tabIndex={-1}>
            SHARIBO
          </h1>
          <div className="row">
            <ConnectionStatus online={online} />
            <a className="link" href={explorerContract()} target="_blank" rel="noreferrer">
              circle #{circleId?.toString()} on-chain ↗
            </a>
            <button
              className="btn btn-small"
              disabled={!!busy}
              onClick={resetToLanding}
              title={`Start over. Your current circle (#${circleId?.toString()}) keeps living on-chain.`}
            >
              {t("common.startNewCircle")}
            </button>
          </div>
        </div>

        <Stepper step={step} />

        {circlePhase === "loading" ? (
          <>
            <MemberRingSkeleton />
            <div className="pot-bar-wrap" aria-hidden="true">
              <div className="skeleton skeleton-bar" />
            </div>
            <p className="pot-label" aria-hidden="true">
              <span className="skeleton skeleton-label" />
            </p>
            <FundingListSkeleton />
          </>
        ) : (
          <>
            <MemberRing members={members.map(m => ({ funded: m.funded, pending: m.pending }))} revealed={!!claimResult} />

            <div className={styles.potBarWrap}>
              <div
                className="pot-bar"
                style={{ width: `${(fundedCount / CIRCLE_SIZE) * 100}%` }}
              />
            </div>
            <p className="pot-label">
              pot: {(Number(pot) / 1e7).toFixed(1)} / {contributionXlm * CIRCLE_SIZE} XLM ·
              round {round}
              {feeBps > 0 &&
                ` · ${t("pot.fee", {
                  feePercent: (feeBps / 100).toString(),
                  feeRecipient: feeRecipient ? feeRecipient.slice(0, 8) : t("pot.feeUnknown"),
                })}`}
              {cancelled && ` · ${t("cancel.cancelled")}`}
            </p>

        {cancelled && (
          <div className="callout" style={{ backgroundColor: "var(--color-warning-bg)", color: "var(--color-warning-text)" }}>
            <strong>{t("cancel.cancelled")}</strong>
            <p>{t("cancel.cancelledMessage")}</p>
          </div>
        )}

        {!cancelled && admin && (
          <div className="row" style={{ justifyContent: "flex-end", marginTop: "1rem" }}>
            <button
              className="btn btn-danger btn-small"
              disabled={!!busy || onChainContributors.length === 0}
              onClick={doCancelCircle}
              title="Cancel this circle and refund all contributors"
            >
              {t("cancel.title")}
            </button>
          </div>
        )}

        <h2>Fund</h2>
        <div className={styles.members}>
          {members.map((m, i) => (
            <div key={i} className={`member ${m.funded ? "funded" : ""} ${m.pending ? "pending" : ""}`}>
              <span className="member-addr">
                {t("fund.memberLabel", { index: i + 1 })} · {short(m.keypair.publicKey())}
                <CopyButton
                  value={m.keypair.publicKey()}
                  label={t("fund.memberAddressLabel", { index: i + 1 })}
                />
              </span>
              {m.pending ? (
                <span className="pending-indicator">⟳ submitting…</span>
              ) : m.funded ? (
                <a
                  className={styles.link}
                  href={explorerTx(m.fundHash!)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("fund.fundedLink")}
                </a>
              ) : (
                <div className={styles.row}>
                  <button
                    className={`${styles.btn} ${styles.btnSmall}`}
                    disabled={!online || !!busy || round > 0}
                    onClick={() => fundMember(i)}
                  >
                    {t("fund.demoButton", { amount: contributionXlm })}
                  </button>
                  {hasFreighter && (
                    <button
                      className={`${styles.btn} ${styles.btnSmall}`}
                      disabled={!online || !!busy || round > 0}
                      onClick={() => fundWithFreighter(i)}
                    >
                      {t("fund.freighterButton")}
                    </button>
                  )}
                </div>
              )}
                </div>
              ))}
            </div>
          </>
        )}

        {fullyFunded && !claimResult && (
          <>
            <h2 ref={claimHeadingRef} tabIndex={-1}>
              {t("claim.heading")}
            </h2>
            <p className={styles.sub}>
              Pick which member is claiming this round — the proof will show the
              contract that they're a real member <em>without</em> revealing
              which one.
            </p>
            <div className="row">
              {members.map((m, i) => (
                <label key={i} className="radio">
                  <input
                    type="radio"
                    checked={claimantIndex === i}
                    onChange={() => setClaimantIndex(i)}
                    disabled={!!busy || !!m.ineligible}
                    title={m.ineligible ? m.ineligibleReason ?? "Ineligible to claim" : undefined}
                  />
                  member {i + 1}{m.ineligible ? " (ineligible)" : ""}
                </label>
              ))}
            </div>
            <button className="btn btn-primary" disabled={!online || !!busy} onClick={doClaim}>
              {claimStage ? CLAIM_STAGE_LABELS[claimStage] : "Generate proof & claim"}
            </button>
            <ClaimExplainer />
            {busy && (
              <p className={styles.techline}>
                {/* Constraint count: update this AND circuits/README.md if the circuit changes. */}
                Groth16 · BLS12-381 · 1,452 constraints · proving locally in your browser, nothing
                sent anywhere until the proof is done
                {isProving && proveElapsedSeconds !== null ? ` · proving… ${proveElapsedSeconds}s` : ""}
              </p>
            )}
          </>
        )}

        {claimResult && (
          <div className={styles.result}>
            <h2 ref={payoutHeadingRef} tabIndex={-1}>
              {t("result.heading")}
            </h2>
            <p>
              {t("result.recipientIntro")} <code>{short(claimResult.recipient)}</code>
              <CopyButton
                value={claimResult.recipient}
                label={t("result.recipientLabel")}
              />{" "}
              <a href={explorerAccount(claimResult.recipient)} target="_blank" rel="noreferrer">
                ↗
              </a>{" "}
              {t("result.recipientOutro")}
            </p>
            <a
              className={styles.link}
              href={explorerTx(claimResult.hash)}
              target="_blank"
              rel="noreferrer"
            >
              {t("result.viewClaimTx")}
            </a>
            <CopyButton value={claimResult.hash} label="claim transaction hash" />
            <p className={styles.callout}>
              Compare the 5 funding transactions above to this claim — same
              contract, no shared address, no visible link.
            </p>
            <p className="techline">
              proof generated in {(claimResult.proofDurationMs / 1000).toFixed(1)}s ·
              local verify {claimResult.verifyTimeMs.toFixed(0)}ms ✓
            </p>
            <button
              className={`${styles.btn} ${styles.btnDanger}`}
              disabled={!online || !!busy || (!!rejection && nullifierClaimed)}
              onClick={claimAgain}
              title={
                rejection && nullifierClaimed ? t("result.claimAgainTitle") : undefined
              }
            >
              {busy ?? t("result.claimAgainButton")}
            </button>
            {nullifierClaimed && !rejection && (
              <p className={styles.callout}>
                <code>has_claimed</code> is true for this nullifier — a replay will be rejected
                on-chain.
              </p>
            )}
            {rejection && (
              <>
                <div className={styles.rejected}>
                  <strong>Rejected on-chain:</strong> {rejection}
                </div>
                <button
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  disabled={!!busy}
                  onClick={resetToLanding}
                >
                  {t("result.startNewCircle")}
                </button>
              </>
            )}
            {rejection && (
              <div className={styles.newCircleCta}>
                <button
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  disabled={!!busy}
                  onClick={resetToLanding}
                >
                  {t("result.startNewCircleAlt")}
                </button>
                <p className={styles.fineprint}>
                  Circle #{circleId?.toString()} stays on-chain forever —{" "}
                  <a className={styles.link} href={explorerContract()} target="_blank" rel="noreferrer">
                    view on explorer ↗
                  </a>
                  {t("result.newCircleOutro")}
                </p>
              </div>
            )}
          </div>
        )}

        {error && <p className="error">{error}</p>}

        {/* ── Debug bundle footer ──────────────────────────────────────────
          Always visible once a circle is active so a user can grab the
          snapshot at any point — not just on error. Placed last so it
          doesn't distract from the happy path. */}
        <div className="debug-bundle-footer">
          <CopyDebugBundleButton
            circleId={circleId}
            round={round}
            currentStep={claimStage}
            lastError={error}
            fundedCount={fundedCount}
            circleSize={CIRCLE_SIZE}
            pot={pot}
            timings={stepTimings}
          />
        </div>
      </div>
    </div>
  );
}
