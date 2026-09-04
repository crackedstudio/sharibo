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
import { I18nProvider } from "./i18n.js";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
);
