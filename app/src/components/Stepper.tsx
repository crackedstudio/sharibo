import { useI18n } from "../i18n.js";
import styles from "./Stepper.module.css";

export function Stepper({ step }: { step: 0 | 1 | 2 | 3 }) {
  const { t } = useI18n();
  const labels = [t("step.create"), t("step.fund"), t("step.proveClaim"), t("step.unlinked")];
  return (
    // nav + ol give screen readers "step N of 4" list semantics without
    // changing any visual output — CSS targets .stepper and .step as before.
    <nav aria-label={t("circle.stepperAria")}>
      <ol className={styles.stepper} style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {labels.map((label, i) => {
          const state = i < step ? styles.done : i === step ? styles.active : "";
          return (
            <li
              key={label}
              className={`${styles.step} ${state}`}
              // aria-current="step" marks the single active step; completed
              // and upcoming steps get no aria-current attribute at all.
              {...(i === step ? { "aria-current": "step" as const } : {})}
            >
              {/* The dot (✓ / number) is decorative — the li text already
                  conveys position, so hide the dot from the AT tree. */}
              <span className={styles.stepDot} aria-hidden="true">
                {i < step ? "✓" : i + 1}
              </span>
              {label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
