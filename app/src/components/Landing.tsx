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
        <p className={styles.tagline}>
          A private rotating savings circle — on Stellar, with real zero-knowledge proofs.
        </p>
        <p className={styles.sub}>
          Every round, everyone contributes. Every round, one member takes the pot. Sharibo proves{" "}
          <em>who's entitled to claim</em> without ever revealing <em>who</em> claimed.
        </p>
        <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!!busy} onClick={onLaunch}>
          {busy ?? "Launch a 5-member circle on testnet"}
        </button>
        {error && <p className={styles.error}>{error}</p>}
        {previousCircleId !== null && (
          <p className={styles.fineprint}>
            Your previous circle lives on at{" "}
            <a className={styles.link} href={explorerContract()} target="_blank" rel="noreferrer">
              circle #{previousCircleId.toString()} ↗
            </a>
          </p>
        )}
        <p className={styles.fineprint}>
          Testnet only. Demo identities are generated fresh in your browser, never reused.
        </p>
      </div>
    </div>
  );
}
