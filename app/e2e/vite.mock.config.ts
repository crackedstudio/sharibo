/**
 * Vite config used ONLY by the default (mock) e2e run.
 *
 * Deliberately standalone rather than merging ../vite.config.ts, so nothing
 * from a developer's normal dev setup can leak in.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");
const repoRoot = path.resolve(appDir, "..");

export default defineConfig({
  root: appDir,
  plugins: [react()],
  define: { global: "globalThis" },
  resolve: {
    alias: [
      // The app (and main.tsx) get the mock layer …
      { find: /^@sharibo\/client$/, replacement: path.join(here, "mock", "client.mock.ts") },
      // … which itself re-exports the real, built SDK under this name.
      {
        find: "@sharibo/client-real",
        replacement: path.join(repoRoot, "packages", "client", "dist", "index.browser.js"),
      },
    ],
  },
  server: { fs: { allow: [repoRoot] } },
});
