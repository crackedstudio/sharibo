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
  online,
  previousCircleId,
  onLaunch,
}: {
  online: boolean;
  previousCircleId: bigint | null;
  onLaunch: () => void;
}) {
  const { t } = useI18n();
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
      </div>
    </div>
  );
}
