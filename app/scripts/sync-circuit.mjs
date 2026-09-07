// Copies the (gitignored, locally-built) circuit artifacts into
// app/public/circuits so Vite can serve them for browser-side proving.
// Run circuits/scripts/{compile,setup}.sh first if these are missing.
//
// Usage:
//   node scripts/sync-circuit.mjs            # one-shot sync
//   node scripts/sync-circuit.mjs --watch    # watch & auto-sync on change
import { copyFileSync, existsSync, mkdirSync, watch } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.join(appDir, "..");
const buildDir = path.join(repoRoot, "circuits", "build");
const outDir = path.join(appDir, "public", "circuits");
const verifierPath = path.join(repoRoot, "circuits", "scripts", "verify-artifacts.mjs");

const files = [
  { from: path.join(buildDir, "membership_js", "membership.wasm"), to: "membership.wasm" },
  { from: path.join(buildDir, "membership_final.zkey"), to: "membership_final.zkey" },
  { from: path.join(repoRoot, "circuits", "verification_key.json"), to: "verification_key.json" },
];

const isWatch = process.argv.includes("--watch");

function sync() {
  const verify = spawnSync(process.execPath, [verifierPath], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (verify.status !== 0) {
    if (!isWatch) process.exit(verify.status ?? 1);
    return;
  }

  mkdirSync(outDir, { recursive: true });

  let missing = false;
  for (const f of files) {
    if (!existsSync(f.from)) {
      console.error(`missing: ${f.from}`);
      missing = true;
      continue;
    }
    copyFileSync(f.from, path.join(outDir, f.to));
  }

  if (missing) {
    console.error(
      "\nRun circuits/scripts/compile.sh and circuits/scripts/setup.sh first (see README).",
    );
    if (!isWatch) process.exit(1);
    return;
  }

  console.log(`[${new Date().toLocaleTimeString()}] circuit artifacts synced to app/public/circuits/`);
}

sync();

if (isWatch) {
  // Watch the source directories for changes and re-sync.
  const watchPaths = [
    buildDir,
    path.join(repoRoot, "circuits", "verification_key.json"),
  ];

  for (const target of watchPaths) {
    if (!existsSync(target)) continue;
    watch(target, { recursive: target === buildDir }, (eventType, filename) => {
      if (!filename) return;
      console.log(`[${new Date().toLocaleTimeString()}] change detected: ${filename}`);
      sync();
    });
  }

  console.log(`[${new Date().toLocaleTimeString()}] watching for circuit changes ...`);
}
