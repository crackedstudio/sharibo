/// <reference types="vitest" />
import { defineConfig, mergeConfig } from "vitest/config";
import fs from "fs";
import path from "path";
import viteConfig from "./vite.config.js";

// Shares the same plugin-react config as vite.config.ts so JSX transform and
// Fast Refresh are applied identically in tests and in the dev server.
const thresholdsPath = path.resolve(__dirname, "..", "..", "coverage-thresholds.json");
let appThreshold = { statements: 0, branches: 0, functions: 0, lines: 0 };
try {
  const data = fs.readFileSync(thresholdsPath, "utf8");
  const parsed = JSON.parse(data);
  if (parsed && parsed.app) appThreshold = parsed.app;
} catch (e) {
  // Missing thresholds file is non-fatal; continue with permissive defaults
}

export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  test: {
    // jsdom provides a browser-like DOM environment without a real browser.
    environment: "jsdom",
    // Import @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
    // globally before every test file.
    setupFiles: ["./src/setupTests.ts"],
    globals: true,
    // No `test.env` VITE_* defaults here on purpose. Whatever is stubbed here
    // is baked into import.meta.env for the whole run, so config.test.ts's
    // "reports missing" cases could never see a genuinely absent variable —
    // vi.stubEnv(key, undefined) cannot undo a value that was injected at
    // transform time. Tests that need a valid config mock ./config (see
    // App.test.tsx) or stub the variables themselves (config.test.ts).
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json"],
      include: ["src/**/*.{ts,tsx,js,jsx}"],
      exclude: ["**/*.test.*", "**/test-setup.*"],
      reportsDirectory: "coverage/app",
      thresholds: {
        statements: appThreshold.statements,
        branches: appThreshold.branches,
        functions: appThreshold.functions,
        lines: appThreshold.lines,
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // jsdom provides a browser-like DOM environment without a real browser.
      environment: "jsdom",
      // Import @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
      // globally before every test file.
      setupFiles: ["./src/setupTests.ts"],
      globals: true,
      // Playwright specs live in e2e/ and run via `npm run test:e2e` (mock by
      // default, live only with E2E_LIVE=1). They must never be collected here,
      // so `npm test` stays fast and cannot touch a browser or the network.
      exclude: [...configDefaults.exclude, "e2e/**"],
      // Config.ts validates VITE_* env vars at module load and the app renders
      // a blocking "setup required" screen when they're missing. Supply valid
      // values here so component tests exercise the real landing screen.
      env: {
        VITE_SHARIBO_CONTRACT_ID: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        VITE_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
        VITE_STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
        VITE_TEST_TOKEN_CONTRACT_ID: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov", "json"],
        include: ["src/**/*.{ts,tsx,js,jsx}"],
        exclude: ["**/*.test.*", "**/test-setup.*"],
        reportsDirectory: "coverage/app",
        thresholds: {
          statements: appThreshold.statements,
          branches: appThreshold.branches,
          functions: appThreshold.functions,
          lines: appThreshold.lines,
        },
      },
    },
  }),
);
