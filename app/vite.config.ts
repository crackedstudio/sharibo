/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  plugins: [react(), visualizer({ filename: "dist/stats.html" }) as any],
  define: {
    global: "globalThis",
  },
  build: {
    // The landing-page budget check (scripts/check-bundle-budget.mjs) walks the
    // build manifest to find which chunks the entry actually imports, so it can
    // assert none of them contain proving code and that they stay small.
    manifest: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    globals: true,
  },
});
