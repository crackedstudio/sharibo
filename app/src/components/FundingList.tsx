import { explorerTx, short } from "../lib/explorer.js";
import { useI18n } from "../i18n.js";
import type { Member } from "../types.js";
import { CopyButton } from "./CopyButton.js";
import styles from "./FundingList.module.css";

export function FundingList({
  members,
  busy,
  round,
  contributionXlm,
  online,
  hasFreighter,
  onFund,
  onFundWithFreighter,
  showRefundInfo = false,
}: {
  members: Member[];
  busy: string | null;
  round: number;
  contributionXlm: number;
  online: boolean;
  hasFreighter: boolean;
  onFund: (i: number) => void;
  onFundWithFreighter: (i: number) => void;
  showRefundInfo?: boolean;
}) {
  const { t } = useI18n();

  return (
    <>
      <h2>{t("fund.heading")}</h2>
      {showRefundInfo && (
        <p className="sub" style={{ marginBottom: "1rem" }}>
          {t("cancel.refundInfo")}
        </p>
      )}
      <div className={styles.members}>
        {members.map((m, i) => (
          <div
            key={i}
            className={`${styles.member} ${m.funded ? styles.funded : ""} ${m.pending ? styles.pending : ""}`}
          >
            <span className={styles.memberAddr}>
              {t("fund.memberLabel", { index: i + 1 })} · {short(m.keypair.publicKey())}
              <CopyButton
                value={m.keypair.publicKey()}
                label={t("fund.memberAddressLabel", { index: i + 1 })}
              />
            </span>
            {m.pending ? (
              <span className="pending-indicator">⟳ submitting…</span>
            ) : m.funded ? (
              <>
                <a className={styles.link} href={explorerTx(m.fundHash!)} target="_blank" rel="noreferrer">
                  {t("fund.fundedLink")}
                </a>
                {showRefundInfo && (
                  <span className="refund-indicator" style={{ marginLeft: "0.5rem", color: "var(--color-warning-text)" }}>
                    {t("cancel.willBeRefunded")}
                  </span>
                )}
              </>
            ) : (
              <div className="row">
                <button
                  className={`${styles.btn} ${styles.btnSmall}`}
                  disabled={!online || !!busy || round > 0}
                  onClick={() => onFund(i)}
                >
                  {t("fund.demoButton", { amount: contributionXlm })}
                </button>
                {hasFreighter && (
                  <button
                    className={`${styles.btn} ${styles.btnSmall}`}
                    disabled={!online || !!busy || round > 0}
                    onClick={() => onFundWithFreighter(i)}
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
  );
}

export function FundingListSkeleton() {
  return (
    <div aria-hidden="true">
      <h2>Fund</h2>
      <div className="members">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="member skeleton-member-row">
            <span className="skeleton skeleton-text" style={{ width: `${140 + i * 12}px` }} />
            <span className="skeleton skeleton-text-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
