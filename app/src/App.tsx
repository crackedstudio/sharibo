/**
 * App.tsx — the landing shell.
 *
 * Everything a first-time visitor needs (landing copy, i18n, config gate) and
 * nothing else. The circle screen — and therefore `@sharibo/client` with its
 * snarkjs / Poseidon / `@stellar/stellar-sdk` payload — is loaded through
 * `React.lazy` so it lands in its own chunk, fetched only when someone
 * actually starts a circle (issue #300).
 *
 * Keep the imports below SDK-free: `scripts/check-bundle-budget.mjs` fails the
 * build if proving code becomes statically reachable from this entry chunk.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { CircleLoadingFallback, EnvSetupScreen } from "./components/Shell.js";
import { Landing } from "./components/Landing.js";
import { configError } from "./config";
import { useI18n } from "./i18n";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import styles from "./App.module.css";

// ── Saved-session decoding ──────────────────────────────────────────────────
// A restored session round-trips bigints (circle id, round, proof scalars)
// through sessionStorage, which only stores strings.

const BIGINT_MARKER = "BIGINT::";

function reviver(key: string, value: unknown): unknown {
  if (typeof value === "string" && value.startsWith(BIGINT_MARKER)) {
    return BigInt(value.slice(BIGINT_MARKER.length));
  }
  return value;
}

/**
 * The circle screen — every SDK import, the Freighter wallet, the artifact
 * download and all contract calls. Held as a lazy reference so Rollup emits it
 * as a separate chunk that the landing screen never pulls in.
 */
const CircleScreen = lazy(() => import("./screens/CircleScreen.js"));

interface SavedSession {
  circleId: bigint;
}

export default function App() {
  const { t } = useI18n();
  const online = useOnlineStatus();
  const [screen, setScreen] = useState<"landing" | "circle">("landing");
  // A saved session handed to the circle screen when the user chooses to
  // resume; null means "create a fresh circle".
  const [activeSession, setActiveSession] = useState<unknown | null>(null);
  const [resumePrompt, setResumePrompt] = useState<SavedSession | null>(null);
  // Survives leaving the circle screen so the landing can point back at the
  // circle the user just left — it keeps living on-chain.
  const [previousCircleId, setPreviousCircleId] = useState<bigint | null>(null);

  useEffect(() => {
    const saved =
      typeof sessionStorage !== "undefined" ? sessionStorage.getItem("sharibo_demo_state") : null;
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved, reviver);
      if (parsed && parsed.circleId) {
        setResumePrompt(parsed);
      }
    } catch {
      sessionStorage.removeItem("sharibo_demo_state");
    }
  }, []);

  // Every hook above must run on every render, so this check sits after them.
  // configError is computed once at module load, so it still reliably
  // short-circuits into the setup screen.
  if (configError.length > 0) {
    return <EnvSetupScreen errors={configError} />;
  }

  if (resumePrompt && screen === "landing") {
    return (
      <div className={styles.page}>
        <div className={`${styles.card} ${styles.hero}`}>
          <h1>{t("resume.heading", { id: resumePrompt.circleId.toString() })}</h1>
          <p className={styles.sub}>{t("resume.subtitle")}</p>
          <div
            className={styles.row}
            style={{ marginTop: "2rem", justifyContent: "center", gap: "1rem" }}
          >
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => {
                setActiveSession(resumePrompt);
                setResumePrompt(null);
                setScreen("circle");
              }}
            >
              {t("resume.resumeButton")}
            </button>
            <button
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={() => {
                sessionStorage.removeItem("sharibo_demo_state");
                setResumePrompt(null);
              }}
            >
              {t("resume.discardButton")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "landing") {
    return (
      <Landing
        online={online}
        previousCircleId={previousCircleId}
        onLaunch={() => setScreen("circle")}
      />
    );
  }

  return (
    <Suspense fallback={<CircleLoadingFallback />}>
      <CircleScreen
        initialState={activeSession}
        onExit={(circleId) => {
          setPreviousCircleId(circleId);
          setActiveSession(null);
          setScreen("landing");
        }}
      />
    </Suspense>
  );
}
