import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveMode } from "./mode.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");
const repoRoot = path.resolve(appDir, "..");

/**
 * Fail fast, with the fix, when a prerequisite is missing. Without this a
 * missing zkey shows up as an opaque wasm parse error 30 seconds into the
 * claim (Vite's SPA fallback happily serves index.html for the missing file).
 */
export default function globalSetup(): void {
  const problems: string[] = [];

  for (const file of ["membership.wasm", "membership_final.zkey", "verification_key.json"]) {
    const p = path.join(appDir, "public", "circuits", file);
    if (!existsSync(p) || statSync(p).size === 0) {
      problems.push(
        `app/public/circuits/${file} is missing. Build the circuit (just circuits), then: npm run sync-circuit --workspace=app`,
      );
    }
  }

  if (!existsSync(path.join(repoRoot, "packages", "client", "dist", "index.browser.js"))) {
    problems.push(
      "packages/client/dist is missing. Build the SDK: npm run build --workspace=packages/client",
    );
  }

  if (problems.length > 0) {
    throw new Error(`e2e prerequisites are not met:\n  - ${problems.join("\n  - ")}`);
  }

  if (resolveMode(process.env) === "live") {
    console.warn(
      "\n" +
        "╔══════════════════════════════════════════════════════════════╗\n" +
        "║  LIVE MODE (E2E_LIVE=1): real testnet + Friendbot requests.  ║\n" +
        "║  This run spends testnet funds and Friendbot quota.          ║\n" +
        "╚══════════════════════════════════════════════════════════════╝\n",
    );
  }
}
