import { explorerTx, short } from "../lib/explorer.js";
import { useI18n } from "../i18n.js";
import type { Member } from "../types.js";
import styles from "./FundingList.module.css";

export function FundingList({
  members,
  busy,
  round,
  contributionXlm,
  onFund,
  showRefundInfo = false,
}: {
  members: Member[];
  busy: string | null;
  round: number;
  contributionXlm: number;
  onFund: (i: number) => void;
  showRefundInfo?: boolean;
}) {
  const { t } = useI18n();
  
  return (
    <>
      <h2>Fund</h2>
      {showRefundInfo && (
        <p className="sub" style={{ marginBottom: '1rem' }}>
          {t("cancel.refundInfo")}
        </p>
      )}
      <div className="members">
        {members.map((m, i) => (
          <div key={i} className={`member ${m.funded ? "funded" : ""} ${m.pending ? "pending" : ""}`}>
            <span className="member-addr">
              {t("fund.memberLabel", { index: i + 1 })} · {short(m.keypair.publicKey())}
            </span>
            {m.pending ? (
              <span className="pending-indicator">⟳ submitting…</span>
            ) : m.funded ? (
              <>
                <a className="link" href={explorerTx(m.fundHash!)} target="_blank" rel="noreferrer">
                  ✓ funded ↗
                </a>
                {showRefundInfo && (
                  <span className="refund-indicator" style={{ marginLeft: '0.5rem', color: 'var(--color-warning-text)' }}>
                    {t("cancel.willBeRefunded")}
                  </span>
                )}
              </>
            ) : (
              <button
                className={`${styles.btn} ${styles.btnSmall}`}
                disabled={!!busy || round > 0}
                onClick={() => onFund(i)}
              >
                {t("fund.demoButton", { amount: contributionXlm })}
              </button>
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
