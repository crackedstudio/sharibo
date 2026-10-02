import type { Ref } from "react";
import { explorerAccount, explorerContract, explorerTx, short } from "../lib/explorer.js";
import { useI18n } from "../i18n.js";
import type { ClaimResult } from "../types.js";
import { CopyButton } from "./CopyButton.js";
import styles from "./ResultCard.module.css";

export function ResultCard({
  claimResult,
  rejection,
  busy,
  nullifierClaimed,
  circleId,
  online = true,
  onClaimAgain,
  onReset,
  headingRef,
}: {
  claimResult: ClaimResult;
  rejection: string | null;
  busy: string | null;
  nullifierClaimed: boolean;
  circleId: bigint | null;
  online?: boolean;
  onClaimAgain: () => void;
  onReset: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.result}>
      <h2 ref={headingRef} tabIndex={-1}>
        {t("result.heading")}
      </h2>
      <p>
        {t("result.recipientIntro")} <code>{short(claimResult.recipient)}</code>
        <CopyButton value={claimResult.recipient} label={t("result.recipientLabel")} />{" "}
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
        view claim transaction ↗
      </a>
      <p className={styles.callout}>
        Compare the 5 funding transactions above to this claim — same contract, no shared address,
        no visible link.
      </p>
      <button
        className={`${styles.btn} ${styles.btnDanger}`}
        disabled={!!busy}
        onClick={onClaimAgain}
      >
        {busy ?? "Try to claim again with the same proof"}
      </button>
      {nullifierClaimed && !rejection && (
        <p className={styles.callout}>
          <code>has_claimed</code> is true for this nullifier — a replay will be rejected on-chain.
        </p>
      )}
      {rejection && (
        <>
          <div className={styles.rejected}>
            <strong>{t("result.rejectedLabel")}</strong> {rejection}
          </div>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            disabled={!!busy}
            onClick={onReset}
          >
            Start a new circle
          </button>
        </>
      )}
      {rejection && (
        <div className="new-circle-cta">
          <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!!busy} onClick={onReset}>
            {t("result.startNewCircleAlt")}
          </button>
          <p className="fineprint">
            {t("result.livesOnChain", { id: circleId?.toString() ?? "" })}{" "}
            <a className={styles.link} href={explorerContract()} target="_blank" rel="noreferrer">
              {t("result.viewExplorer")}
            </a>
            {t("result.newCircleOutro")}
          </p>
        </div>
      )}
    </div>
  );
}
