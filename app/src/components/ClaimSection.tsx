import type { FeeEstimate } from "@sharibo/client";
import type { Member } from "../types.js";
import styles from "./ClaimSection.module.css";
import type { ClaimStage } from "../types.js";

export function ClaimSection({
  members,
  claimantIndex,
  onSelectClaimant,
  busy,
  onClaim,
}: {
  members: Member[];
  claimantIndex: number;
  onSelectClaimant: (i: number) => void;
  busy: string | null;
  onClaim: () => void;
  // Reserved for the stepper/fee UI (not rendered yet — kept so the
  // component's intended API stays visible to consumers).
  claimStage?: ClaimStage | null;
  proveElapsedSeconds?: number;
  feeEstimate?: FeeEstimate | null;
}) {
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
          Groth16 · BLS12-381 · 1,452 constraints · proving locally in your browser, nothing sent
          anywhere until the proof is done
        </p>
      )}
    </>
  );
}
