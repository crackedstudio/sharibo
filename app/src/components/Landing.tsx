import { explorerContract } from "../lib/explorer.js";
import styles from "./Landing.module.css";
import { useI18n } from "../i18n.js";

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

interface NetworkBannerProps {
  networkPassphrase: string;
}

export function NetworkBanner({ networkPassphrase }: NetworkBannerProps) {
  const isTestnet = networkPassphrase.toLowerCase().includes("test");
  if (!isTestnet) return null;
  return (
    <div className="network-banner">
      Stellar testnet — no real funds ·{" "}
      <a
        href="https://github.com/crackedstudio/sharibo#honest-limitations"
        target="_blank"
        rel="noreferrer"
      >
        limitations ↗
      </a>
    </div>
  );
}

export function Landing({
  busy,
  error,
  previousCircleId,
  onLaunch,
}: {
  busy: string | null;
  error: string | null;
  previousCircleId: bigint | null;
  onLaunch: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <div className={`${styles.card} ${styles.hero}`}>
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
          {t("landing.sub.before")} <em>{t("landing.sub.em1")}</em> {t("landing.sub.middle")}{" "}
          <em>{t("landing.sub.em2")}</em> {t("landing.sub.after")}
        </p>
        <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!!busy} onClick={onLaunch}>
          {busy ?? t("landing.launch")}
        </button>
        {error && <p className={styles.error}>{error}</p>}
        {previousCircleId !== null && (
          <p className={styles.fineprint}>
            {t("landing.previousCirclePrefix")}{" "}
            <a className={styles.link} href={explorerContract()} target="_blank" rel="noreferrer">
              {t("landing.previousCircleLink", { id: previousCircleId.toString() })}
            </a>
          </p>
        )}
        <p className={styles.fineprint}>{t("landing.testnetFineprint")}</p>
      </div>
    </div>
  );
}
