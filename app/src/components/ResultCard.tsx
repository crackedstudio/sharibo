import { explorerAccount, explorerTx, short } from "../lib/explorer.js";
import { useI18n } from "../i18n.js";
import type { ClaimResult } from "../types.js";
import styles from "./ResultCard.module.css";

export function ResultCard({
  claimResult,
  rejection,
  busy,
  nullifierClaimed,
  circleId,
  onClaimAgain,
  onReset,
}: {
  claimResult: ClaimResult;
  rejection: string | null;
  busy: string | null;
  nullifierClaimed: boolean;
  circleId: bigint | null;
  onClaimAgain: () => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.result}>
      <h2>Payout landed</h2>
      <p>
        {t("result.recipientIntro")} <code>{short(claimResult.recipient)}</code>{" "}
        <a href={explorerAccount(claimResult.recipient)} target="_blank" rel="noreferrer">
          ↗
        </a>{" "}
        {t("result.recipientOutro")}
      </p>
      <a className={styles.link} href={explorerTx(claimResult.hash)} target="_blank" rel="noreferrer">
        view claim transaction ↗
      </a>
      <p className={styles.callout}>
        Compare the 5 funding transactions above to this claim — same contract, no shared address,
        no visible link.
      </p>
      <button className={`${styles.btn} ${styles.btnDanger}`} disabled={!!busy} onClick={onClaimAgain}>
        {busy ?? "Try to claim again with the same proof"}
      </button>
      {nullifierClaimed && !rejection && (
        <p className="callout">
          <code>has_claimed</code> is true for this nullifier — a replay will be rejected on-chain.
        </p>
      )}
      {rejection && (
        <>
          <div className={styles.rejected}>
            <strong>Rejected on-chain:</strong> {rejection}
          </div>
          <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!!busy} onClick={onReset}>
            Start a new circle
          </button>
        </>
      )}
    </div>
  );
}
