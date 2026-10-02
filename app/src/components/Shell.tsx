/**
 * Shell.tsx — the chrome both screens share.
 *
 * Everything here is deliberately free of `@sharibo/client` / snarkjs /
 * `@stellar/stellar-sdk` imports so the landing entry chunk stays free of the
 * proving stack (issue #300). The circle screen imports the same components
 * from here rather than duplicating them, which also means they are bundled
 * once instead of twice.
 */
import { config } from "../config.js";
import { useI18n } from "../i18n.js";
import styles from "../App.module.css";

const README_URL = "https://github.com/crackedstudio/sharibo#honest-limitations";

/**
 * True unless the configured passphrase is Stellar mainnet's. This mirrors
 * `networks.ts`'s `networkOf(passphrase) !== "mainnet"` — an unknown
 * passphrase still counts as testnet, exactly as before — but compares against
 * the literal rather than importing the SDK's helper, because this file is in
 * the landing chunk and must stay SDK-free (issue #300).
 */
const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";
const isTestnet = config?.networkPassphrase !== MAINNET_PASSPHRASE;

export function NetworkBanner() {
  const { t } = useI18n();
  if (!isTestnet) return null;
  return (
    <div className={styles.networkBanner}>
      Stellar testnet — no real funds ·{" "}
      <a href={README_URL} target="_blank" rel="noreferrer">
        {t("banner.limitationsShort")}
      </a>
    </div>
  );
}

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, locales, setLocale } = useI18n();
  return (
    <div className={`language-switcher ${className}`}>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
        aria-label="Language"
      >
        {locales.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
    </div>
  );
}

export function EnvSetupScreen({ errors }: { errors: string[] }) {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <div className={`${styles.card} ${styles.hero}`}>
        <LanguageSwitcher className={styles.languageSwitcherHero} />
        <h1>SHARIBO</h1>
        <h2 style={{ color: "var(--color-error, #e55)" }}>{t("env.setupRequired")}</h2>
        <p className={styles.sub}>
          {t("env.setupIntro")} {t("env.setupHowTo")}
        </p>
        <ul style={{ textAlign: "left", margin: "1rem 0", padding: "0 1.25rem" }}>
          {errors.map((err) => (
            <li key={err} style={{ marginBottom: "0.5rem" }}>
              <code>{err}</code>
            </li>
          ))}
        </ul>
        <p className={styles.fineprint}>
          {t("env.setupDetails")}
        </p>
      </div>
    </div>
  );
}

// ── Persistent live-region (must stay in DOM) ───────────────────────────────

export function LiveRegion({ message }: { message: string }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}
    >
      {message}
    </div>
  );
}

/**
 * Suspense fallback while the circle chunk (proving stack + circle UI) is
 * being fetched. Deliberately tiny: it renders in the landing chunk, so it
 * must not import anything heavy. An empty shell that announces itself is
 * better than a blank flash, and it matches the circle card's footprint.
 */
export function CircleLoadingFallback() {
  return (
    <div className={styles.page}>
      <NetworkBanner />
      <div className={styles.card}>
        <p className="sub" role="status" aria-live="polite">
          Loading the prover…
        </p>
        <div className="pot-bar-wrap" aria-hidden="true">
          <div className="skeleton skeleton-bar" />
        </div>
      </div>
    </div>
  );
}
