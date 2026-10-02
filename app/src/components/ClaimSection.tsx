import type { Ref } from "react";
import { useI18n } from "../i18n.js";
import type { ClaimStage, Member } from "../types.js";
import styles from "./ClaimSection.module.css";

const CLAIM_STAGE_LABELS: Record<ClaimStage, string> = {
  artifacts: "Fetching proving artifacts (wasm + zkey)…",
  proving: "Proving…",
  verifying: "Verifying proof locally…",
  funding: "Funding a fresh, unlinked recipient…",
  submitting: "Submitting the claim…",
};

function ClaimExplainer() {
  const { t } = useI18n();
  return (
    <details className="claim-explainer">
      <summary>{t("explainer.summary")}</summary>
      <div className="claim-explainer-body">
        <section>
          <h3>{t("explainer.sayingTitle")}</h3>
          <p>{t("explainer.sayingBody")}</p>
        </section>
        <section>
          <h3>{t("explainer.secretTitle")}</h3>
          <p>{t("explainer.secretBody")}</p>
        </section>
        <section>
          <h3>{t("explainer.checksTitle")}</h3>
          <ol>
            <li>{t("explainer.check1")}</li>
            <li>{t("explainer.check2")}</li>
            <li>{t("explainer.check3")}</li>
            <li>{t("explainer.check4")}</li>
          </ol>
        </section>
        <section>
          <h3>{t("explainer.observersTitle")}</h3>
          <p>{t("explainer.observersBody")}</p>
        </section>
      </div>
    </details>
  );
}

export function ClaimSection({
  members,
  claimantIndex,
  onSelectClaimant,
  busy,
  claimStage,
  proveElapsedSeconds,
  isProving,
  online,
  onClaim,
  headingRef,
}: {
  members: Member[];
  claimantIndex: number;
  onSelectClaimant: (i: number) => void;
  busy: string | null;
  claimStage: ClaimStage | null;
  proveElapsedSeconds: number;
  isProving: boolean;
  online: boolean;
  onClaim: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { t } = useI18n();
  return (
    <>
      <h2 ref={headingRef} tabIndex={-1}>
        {t("claim.heading")}
      </h2>
      <p className={styles.sub}>
        Pick which member is claiming this round — the proof will show the contract that they're a
        real member <em>without</em> revealing which one.
      </p>
      <div className={styles.row}>
        {members.map((m, i) => (
          <label key={i} className={styles.radio}>
            <input
              type="radio"
              name="claimant"
              checked={claimantIndex === i}
              onChange={() => onSelectClaimant(i)}
              disabled={!!busy || !!m.ineligible}
              title={m.ineligible ? (m.ineligibleReason ?? "Ineligible to claim") : undefined}
            />
            member {i + 1}
            {m.ineligible ? ` (ineligible)` : ""}
          </label>
        ))}
      </div>
      <button className="btn btn-primary" disabled={!online || !!busy} onClick={onClaim}>
        {claimStage ? CLAIM_STAGE_LABELS[claimStage] : "Generate proof & claim"}
      </button>
      <ClaimExplainer />
      {busy && (
        <p className={styles.techline}>
          {/* Constraint count: update this AND circuits/README.md if the circuit changes. */}
          Groth16 · BLS12-381 · 3,757 constraints · proving locally in your browser, nothing sent
          anywhere until the proof is done
          {isProving && proveElapsedSeconds !== null ? ` · proving… ${proveElapsedSeconds}s` : ""}
        </p>
      )}
    </>
  );
}
