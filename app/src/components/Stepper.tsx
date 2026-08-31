import { useI18n } from "../i18n.js";

export function Stepper({ step }: { step: 0 | 1 | 2 | 3 }) {
  const { t } = useI18n();
  const labels = [t("step.create"), t("step.fund"), t("step.proveClaim"), t("step.unlinked")];
  return (
    <div className="stepper">
      {labels.map((label, i) => (
        <div key={label} className={`step ${i < step ? "done" : i === step ? "active" : ""}`}>
          <span className="step-dot">{i < step ? "✓" : i + 1}</span>
          {label}
        </div>
      ))}
    </div>
  );
}