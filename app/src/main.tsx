import { Buffer } from "buffer";
// @stellar/stellar-sdk expects Node's Buffer/global to exist; Vite doesn't
// polyfill these automatically like older webpack setups did.
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
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
import App from "./App.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { getCapabilityReport } from "./lib/capabilities.js";
import { I18nProvider, useI18n } from "./i18n.js";
import "./style.css";

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <ErrorBoundary>
        {capabilityReport.ok ? <App /> : <UnsupportedBrowserScreen />}
      </ErrorBoundary>
    </I18nProvider>
  </StrictMode>,
);