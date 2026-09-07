import { useI18n } from "../i18n.js";
import styles from "./Stepper.module.css";

export function Stepper({ step }: { step: 0 | 1 | 2 | 3 }) {
  const { t } = useI18n();
  const labels = [t("step.create"), t("step.fund"), t("step.proveClaim"), t("step.unlinked")];
  return (
    <div className={styles.stepper}>
      {labels.map((label, i) => (
        <div key={label} className={`${styles.step} ${i < step ? styles.done : i === step ? styles.active : ""}`}>
          <span className={styles.stepDot}>{i < step ? "✓" : i + 1}</span>
          {label}
        </div>
      ))}
    </div>
  );
}