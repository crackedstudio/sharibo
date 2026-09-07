#!/usr/bin/env node
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");

const ALL = process.argv.includes("--all");

function rel(abs) {
  return abs.startsWith(REPO_ROOT)
    ? abs.slice(REPO_ROOT.length + 1)
    : abs;
}

function rmIfExists(p) {
  const abs = resolve(REPO_ROOT, p);
  if (!existsSync(abs)) return 0;
  console.log("  remove", rel(abs));
  rmSync(abs, { recursive: true, force: true });
  return 1;
}

function walk(dir, onFile, skipTopLevelDirs) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (skipTopLevelDirs.has(e.name)) continue;
      walk(full, onFile, skipTopLevelDirs);
    } else if (e.isFile()) {
      onFile(full, e.name);
    }
  }
}

function walkDirs(dir, onDir, skipTopLevelDirs) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (skipTopLevelDirs.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      onDir(full, e.name);
      walkDirs(full, onDir, skipTopLevelDirs);
    }
  }
}

function removeByExtensions(extList) {
  let count = 0;
  const skipDirs = new Set([
    "node_modules",
    ".git",
    ".vscode",
    ".github",
    "docs",
    ".claude",
    ".agents",
  ]);
  walk(REPO_ROOT, (full, name) => {
    for (const ext of extList) {
      if (name.endsWith(ext)) {
        const r = rel(full);
        if (r === "circuits/verification_key.json") return;
        if (/^\.env(\..+)?$/.test(name) && ext === ".json") return;
        console.log("  remove", r);
        rmSync(full, { force: true });
        count++;
        return;
      }
    }
  }, skipDirs);
  return count;
}

function collectAndRemoveDirs(targetName) {
  let count = 0;
  const skip = new Set([
    ".git",
    ".vscode",
    ".github",
    "docs",
    targetName,
  ]);
  const found = [];
  walkDirs(REPO_ROOT, (full, name) => {
    if (name === targetName) found.push(full);
  }, skip);
  const top = resolve(REPO_ROOT, targetName);
  if (existsSync(top) && !found.includes(top)) found.push(top);
  for (const f of found) {
    console.log("  remove", rel(f));
    rmSync(f, { recursive: true, force: true });
    count++;
  }
  return count;
}

console.log(`Running ${ALL ? "clean:all" : "clean"}`);
let removed = 0;

console.log();
console.log("[directories]");
for (const d of [
  "circuits/build",
  "app/public/circuits",
  "app/dist",
  "app/.vite",
]) {
  removed += rmIfExists(d);
}

console.log();
console.log("[generated circom source from template]");
removed += rmIfExists("circuits/membership.circom");

console.log();
console.log("[circuit artifacts (*.ptau / *.zkey / *.wtns)]");
removed += removeByExtensions([".ptau", ".zkey", ".wtns"]);

if (ALL) {
  console.log();
  console.log("[cargo clean in contracts/]");
  const cargoDir = resolve(REPO_ROOT, "contracts");
  if (existsSync(cargoDir)) {
    const cmd = process.platform === "win32" ? "cargo.cmd" : "cargo";
    const manifest = join(cargoDir, "Cargo.toml");
    const args = ["clean", "--manifest-path", manifest];
    console.log(`  ${cmd} ${args.join(" ")}`);
    const r = spawnSync(cmd, args, { stdio: "inherit", cwd: cargoDir });
    if (r.status === 0) removed++;
    else console.warn("  cargo clean exited with code", r.status);
  }

  console.log();
  console.log("[node_modules (root + all workspaces)]");
  removed += collectAndRemoveDirs("node_modules");
}

console.log();
console.log(`Done (cleaned ${removed} entries).`);
if (ALL) {
  console.log();
  console.log("Full reinstall + rebuild required:");
  console.log("  npm install");
  console.log("Then per README:");
  console.log("  (circuits)  npm run compile   # or bash scripts/compile.sh");
  console.log("  (app)       npm run sync-circuit");
  console.log("  (contracts) cargo build --manifest-path contracts/Cargo.toml");
}
