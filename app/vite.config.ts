/// <reference types="vitest" />
import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";

const plugins: PluginOption[] = [react()];

// Optional bundle analysis — `npm run build:analyze` sets ANALYZE=1.
// Default vite/build must not hard-require rollup-plugin-visualizer (#500 / #562).
if (process.env.ANALYZE === "1") {
  try {
    const { visualizer } = await import("rollup-plugin-visualizer");
    plugins.push(visualizer({ filename: "dist/stats.html", open: true }) as PluginOption);
  } catch {
    throw new Error(
      "build:analyze requires rollup-plugin-visualizer. Run: npm install -D rollup-plugin-visualizer",
    );
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins,
  define: {
    global: "globalThis",
  },
});
