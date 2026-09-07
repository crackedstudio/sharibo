import { defineConfig } from "vitest/config";
import fs from "fs";
import path from "path";

const thresholdsPath = path.resolve(__dirname, "..", "..", "coverage-thresholds.json");
let clientThreshold = { statements: 0, branches: 0, functions: 0, lines: 0 };
try {
  const data = fs.readFileSync(thresholdsPath, "utf8");
  const parsed = JSON.parse(data);
  if (parsed && parsed["packages/client"]) clientThreshold = parsed["packages/client"];
} catch (e) {
  // continue with defaults
}

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json"],
      all: true,
      include: ["src/**/*.{ts,js}"],
      exclude: ["**/*.test.*"],
      reportsDirectory: "coverage/packages-client",
      statements: clientThreshold.statements,
      branches: clientThreshold.branches,
      functions: clientThreshold.functions,
      lines: clientThreshold.lines,
    },
  },
});
