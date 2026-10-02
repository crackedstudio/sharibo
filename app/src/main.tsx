// A handful of transitive browser dependencies still reference the bare
// identifier `global`. Assigning it once at startup is a precise, zero-cost
// runtime shim; the old build-time `define: { global: "globalThis" }` in
// vite.config.ts / vitest.config.ts was removed because it text-substituted
// *every* occurrence of `global` (including inside dependencies) and masked
// genuine Node-only imports instead of surfacing them.
//
// Note there is deliberately no `Buffer` polyfill here: the app targets
// @stellar/stellar-sdk ^16, which imports cleanly with no Node APIs (guarded
// by packages/client/src/node-import.test.ts), and packages/client hands
// snarkjs Uint8Array/ArrayBuffer values, which need no polyfill in the browser.
(globalThis as unknown as { global: typeof globalThis }).global = globalThis;

// snarkjs's file-loading (via the `fastfile` package) branches on the
// webpack-era `process.browser` convention to decide fetch() vs Node's fs —
// without this, generateProof() throws `process is not defined` the moment
// it tries to load membership.wasm / membership_final.zkey. Vite doesn't
// supply a `process` global by default, unlike webpack.
(globalThis as unknown as { process: Record<string, unknown> }).process = {
  browser: true,
  env: {},
  argv: [],
  exit: () => {},
  nextTick: (fn: () => void) => Promise.resolve().then(fn),
};

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// No `@sharibo/client` import here on purpose: the entry module is part of the
// landing bundle, so importing the SDK would drag snarkjs / the Stellar SDK
// back onto the critical path for a visitor who never starts a circle. The
// SDK is reached only from the lazily-loaded circle screen (see App.tsx).
import { startArtifactPrefetch } from "@sharibo/client";
import App from "./App.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { getCapabilityReport } from "./lib/capabilities.js";
import { I18nProvider, useI18n } from "./i18n.js";
import "./tokens.css";

function UnsupportedBrowserScreen() {
  const { t } = useI18n();
  const report = getCapabilityReport();

  const labels: Record<string, string> = {
    webassembly: t("browser.capability.webassembly"),
    bigint: t("browser.capability.bigint"),
    "crypto.subtle": t("browser.capability.cryptoSubtle"),
    "secure-context": t("browser.capability.secureContext"),
  };

  return (
    <div className="page">
      <div className="card hero unsupported-browser">
        <h1 className="small">SHARIBO</h1>
        <h2>{t("browser.unsupportedTitle")}</h2>
        <p className="sub">{t("browser.unsupportedIntro")}</p>
        <p className="sub">{t("browser.unsupportedDetails")}</p>
        <ul className="unsupported-browser-list" aria-label={t("browser.unsupportedMissing")}>
          {report.missing.map((issue) => (
            <li key={issue} className="unsupported-browser-item">
              {labels[issue] ?? issue}
            </li>
          ))}
        </ul>
        {report.missing.includes("secure-context") && (
          <p className="unsupported-browser-note">{t("browser.unsupportedSecureContext")}</p>
        )}
        <p className="fineprint">{t("browser.unsupportedFooter")}</p>
      </div>
    </div>
  );
}

const capabilityReport = getCapabilityReport();
startArtifactPrefetch().catch(() => {
  // The app renders the background progress indicator and handles failures
  // through subscription updates; ignore promise rejections here so the page
  // can keep loading even if the prefetch is interrupted.
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <ErrorBoundary>{capabilityReport.ok ? <App /> : <UnsupportedBrowserScreen />}</ErrorBoundary>
    </I18nProvider>
  </StrictMode>,
);
