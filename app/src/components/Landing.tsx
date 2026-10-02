/**
 * Landing.tsx — the first screen, and the only one in the landing chunk.
 *
 * It must stay free of `@sharibo/client`, snarkjs, Poseidon and
 * `@stellar/stellar-sdk`: the whole point of the code split in issue #300 is
 * that a visitor who never starts a circle never downloads the proving stack.
 * The circle screen (and every SDK import it needs) lives behind
 * `React.lazy` in App.tsx. `scripts/check-bundle-budget.mjs` enforces this.
 */
import styles from "../App.module.css";
import { useI18n } from "../i18n.js";
import { explorerContract } from "../lib/explorer.js";
import { LanguageSwitcher, NetworkBanner } from "./Shell.js";
import { networkOf } from "@sharibo/client";
import type { CircleId } from "@sharibo/client";
import { config } from "../config.js";
import { explorerContract } from "../lib/explorer.js";
import { useI18n } from "../i18n.js";
import type { Failure } from "../state/circleMachine.js";
import { Toaster } from "./Toaster.js";
import styles from "./Landing.module.css";

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

export function Landing({
const README_URL = "https://github.com/glorious21-coder/sharibo#honest-limitations";

export function LocaleSelect({ className = "" }: { className?: string }) {
  const { locale, locales, setLocale, t } = useI18n();
  return (
    <div className={`language-switcher ${className}`}>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
        aria-label={t("lang.label")}
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

export function NetworkBanner() {
  const { t } = useI18n();
  const isTestnet = networkOf(config.networkPassphrase) !== "mainnet";
  if (!isTestnet) return null;
  return (
    <div className="network-banner">
      {t("banner.testnet")} ·{" "}
      <a href={README_URL} target="_blank" rel="noreferrer">
        {t("banner.limitationsShort")}
      </a>
    </div>
  );
}

export function Landing({
  busy,
  error,
  online,
  previousCircleId,
  prevCircle,
  failure,
  onDismissFailure,
  onLaunch,
}: {
  online: boolean;
  previousCircleId: bigint | null;
  busy: string | null;
  error: string | null;
  online: boolean;
  previousCircleId: CircleId | null;
  prevCircle: { id: string; explorerUrl: string } | null;
  failure: Failure | null;
  onDismissFailure: () => void;
  onLaunch: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
    <div className="page">
      <NetworkBanner />
      {!online && (
        <div className="offline-banner" role="status">
          You are offline. Network actions are paused — reconnect to start or retry a circle.
        </div>
      )}
      <div className={`${styles.card} ${styles.hero}`}>
        <LanguageSwitcher className={styles.languageSwitcherHero} />
      <div className={`card ${styles.hero}`}>
        <LocaleSelect className="language-switcher-hero" />
        <div className={styles.namewall}>
          {NAMES.map((n) => (
            <span key={n} className={styles.namewallItem}>
              {n}
            </span>
          ))}
        </div>
        <h1>SHARIBO</h1>
        <p className={styles.tagline}>{t("landing.tagline")}</p>
        <p className={styles.sub}>
          {t("landing.sub.before")} <em>{t("landing.sub.em1")}</em>{" "}
          {t("landing.sub.middle")} <em>{t("landing.sub.em2")}</em>{" "}
          {t("landing.sub.after")}
        </p>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={!online}
          onClick={onLaunch}
        >
          {t("landing.launch")}
        </button>
        {previousCircleId !== null && (
          <p className={styles.fineprint}>
            {t("landing.previousCirclePrefix")}{" "}
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
        <p className={styles.fineprint}>{t("landing.testnetFineprint")}</p>
          {t("landing.sub.before")} <em>{t("landing.sub.em1")}</em> {t("landing.sub.middle")}{" "}
          <em>{t("landing.sub.em2")}</em> {t("landing.sub.after")}
        </p>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={!!busy}
          onClick={onLaunch}
        >
          {busy ?? "Launch a 5-member circle on testnet"}
        </button>
        {error && <p className={styles.error}>{error}</p>}
        <Toaster failure={failure} busy={!!busy} online={online} onDismiss={onDismissFailure} />
        {previousCircleId !== null && (
          <p className={styles.fineprint}>
            {t("landing.previousCirclePrefix")}{" "}
            <a className={styles.link} href={explorerContract()} target="_blank" rel="noreferrer">
              {t("landing.previousCircleLink", { id: previousCircleId.toString() })}
            </a>
          </p>
        )}
        <p className={styles.fineprint}>{t("landing.testnetFineprint")}</p>
        {prevCircle && (
          <p className={styles.fineprint}>
            {t("landing.previousCircleLivesOn", { id: prevCircle.id })}{" "}
            <a className={styles.link} href={prevCircle.explorerUrl} target="_blank" rel="noreferrer">
              {t("landing.viewExplorer")}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
