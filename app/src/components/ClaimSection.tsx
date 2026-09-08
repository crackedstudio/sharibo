import type { FeeEstimate } from "@sharibo/client";
import type { Member } from "../types.js";
import styles from "./ClaimSection.module.css";
import { useI18n } from "../i18n.js";
import type { ClaimStage } from "../types.js";

const STROOPS_PER_XLM = 10_000_000n;

/** Format a stroop amount as a human-readable XLM string, e.g. "0.0123456 XLM". */
function formatXlm(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const frac = stroops % STROOPS_PER_XLM;
  return `${whole}.${frac.toString().padStart(7, "0")} XLM`;
}

export function ClaimSection({
  members,
  claimantIndex,
  onSelectClaimant,
  busy,
  claimStage,
  proveElapsedSeconds,
  onClaim,
  feeEstimate,
}: {
  members: Member[];
  claimantIndex: number;
  onSelectClaimant: (i: number) => void;
  busy: string | null;
  claimStage: ClaimStage | null;
  proveElapsedSeconds: number;
  onClaim: () => void;
  feeEstimate?: FeeEstimate | null;
}) {
  const { t } = useI18n();
  return (
    <>
      <h2>Claim</h2>
      <p className={styles.sub}>
        Pick which member is claiming this round — the proof will show the contract that they're a
        real member <em>without</em> revealing which one.
      </p>
      <div className="row">
        {members.map((m, i) => (
          <label key={i} className="radio">
            <input
              type="radio"
              checked={claimantIndex === i}
              onChange={() => onSelectClaimant(i)}
              disabled={!!busy || !!m.ineligible}
              title={m.ineligible ? m.ineligibleReason ?? "Ineligible to claim" : undefined}
            />
            member {i + 1}{m.ineligible ? ` (ineligible)` : ""}
          </label>
        ))}
      </div>
      <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!!busy} onClick={onClaim}>
        {busy ?? "Generate proof & claim"}
      </button>
      {busy && (
        <p className={styles.techline}>
          Groth16 · BLS12-381 · 3,757 constraints · proving locally in your browser, nothing sent
          anywhere until the proof is done
        </p>
      )}
    </>
  );
}
