import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MOCK_APP_ENV, PORTS, liveConfigProblems, resolveMode } from "./mode.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");

// Mock unless the exact opt-in `E2E_LIVE=1` is present. See ./mode.ts.
const mode = resolveMode(process.env);
const port = PORTS[mode];

if (mode === "live") {
  // Resolve the app's env the way Vite will (app/.env* + process.env) and refuse
  // to start unless it points at testnet with real contract IDs.
  const problems = liveConfigProblems(loadEnv("development", appDir, "VITE_"));
  if (problems.length > 0) {
    throw new Error(
      `E2E_LIVE=1 was set but the live run cannot start:\n  - ${problems.join("\n  - ")}`,
    );
  }
}

export default defineConfig({
  testDir: here,
  testMatch: "**/*.e2e.ts",
  globalSetup: path.join(here, "global-setup.ts"),
  outputDir: path.join(here, "test-results"),

  // One browser, one test at a time, and never retry: in live mode a retry
  // would spend more testnet funds, and in mock mode a flaky pass would hide
  // a real problem.
  fullyParallel: false,
  workers: 1,
  retries: 0,

  // Real Groth16 proving in headless Chromium is the slow part; live adds
  // testnet ledger closes on top of it.
  timeout: mode === "live" ? 15 * 60_000 : 4 * 60_000,
  expect: { timeout: 15_000 },

  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.join(here, "playwright-report") }],
  ],

  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "en-US",
    // The trace is the artifact to grab for the README demo GIF too:
    //   E2E_TRACE=on npm run test:e2e   → keeps a trace even when the run passes.
    trace: process.env.E2E_TRACE === "on" ? "on" : "retain-on-failure",
    video: process.env.E2E_TRACE === "on" ? "on" : "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: mode, use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command:
      mode === "mock"
        ? `npx vite --config e2e/vite.mock.config.ts --host 127.0.0.1 --port ${port} --strictPort`
        : `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: appDir,
    url: `http://127.0.0.1:${port}`,
    // Never adopt a server we did not start: it could carry the wrong mode.
    reuseExistingServer: false,
    timeout: 120_000,
    // Process env outranks .env files in Vite, so a developer's app/.env can
    // never leak real contract IDs into a mock run.
    env: mode === "mock" ? { ...MOCK_APP_ENV } : {},
  },
});
