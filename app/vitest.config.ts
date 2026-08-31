/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Shares the same plugin-react config as vite.config.ts so JSX transform and
// Fast Refresh are applied identically in tests and in the dev server.
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
    // Config.ts validates VITE_* env vars at module load and the app renders
    // a blocking "setup required" screen when they're missing. Supply valid
    // values here so component tests exercise the real landing screen.
    env: {
      VITE_SHARIBO_CONTRACT_ID:
        "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      VITE_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
      VITE_STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
      VITE_TEST_TOKEN_CONTRACT_ID:
        "CYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
    },
  },
});