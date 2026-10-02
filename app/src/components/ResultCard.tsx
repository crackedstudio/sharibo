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
      <a className={styles.link} href={explorerTx(claimResult.hash)} target="_blank" rel="noreferrer">
        {t("result.viewClaimTx")}
      </a>
      <CopyButton value={claimResult.hash} label={t("result.hashLabel")} />
      <p className={styles.callout}>{t("result.callout")}</p>
      {claimResult.proofDurationMs != null && claimResult.verifyTimeMs != null && (
        <p className="techline">
          proof generated in {(claimResult.proofDurationMs / 1000).toFixed(1)}s · local verify{" "}
          {claimResult.verifyTimeMs.toFixed(0)}ms ✓
        </p>
      )}
      <button
        className={`${styles.btn} ${styles.btnDanger}`}
        disabled={!online || !!busy || (!!rejection && nullifierClaimed)}
        onClick={onClaimAgain}
        title={rejection && nullifierClaimed ? t("result.claimAgainTitle") : undefined}
      >
        {busy ?? t("result.claimAgainButton")}
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
          <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!!busy} onClick={onReset}>
            {t("result.startNewCircle")}
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
