#!/usr/bin/env node
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_REPO_ROOT = resolve(__dirname, "../..");

const CLEAN_DIRS = [
  "circuits/build",
  "app/public/circuits",
  "app/dist",
  "app/.vite",
  "packages/client/dist",
  "coverage",
  ".stryker-tmp",
  "packages/client/reports",
];

export function createCleaner(
  repoRoot,
  { all = false, log = console.log, warn = console.warn } = {},
) {
  function rel(abs) {
    return abs.startsWith(repoRoot) ? abs.slice(repoRoot.length + 1) : abs;
  }

  function rmIfExists(p) {
    const abs = resolve(repoRoot, p);
    if (!existsSync(abs)) return 0;
    log("  remove", rel(abs));
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
    walk(
      repoRoot,
      (full, name) => {
        for (const ext of extList) {
          if (name.endsWith(ext)) {
            const r = rel(full);
            if (r === "circuits/verification_key.json") return;
            if (/^\.env(\..+)?$/.test(name) && ext === ".json") return;
            log("  remove", r);
            rmSync(full, { force: true });
            count++;
            return;
          }
        }
      },
      skipDirs,
    );
    return count;
  }

  function collectAndRemoveDirs(targetName) {
    let count = 0;
    const skip = new Set([".git", ".vscode", ".github", "docs", targetName]);
    const found = [];
    walkDirs(
      repoRoot,
      (full, name) => {
        if (name === targetName) found.push(full);
      },
      skip,
    );
    const top = resolve(repoRoot, targetName);
    if (existsSync(top) && !found.includes(top)) found.push(top);
    for (const f of found) {
      log("  remove", rel(f));
      rmSync(f, { recursive: true, force: true });
      count++;
    }
    return count;
  }

  function run() {
    log(`Running ${all ? "clean:all" : "clean"}`);
    let removed = 0;

    log();
    log("[directories]");
    for (const d of CLEAN_DIRS) {
      removed += rmIfExists(d);
    }

    log();
    log("[generated circom source from template]");
    removed += rmIfExists("circuits/membership.circom");

    log();
    log("[circuit artifacts (*.ptau / *.zkey / *.wtns)]");
    removed += removeByExtensions([".ptau", ".zkey", ".wtns"]);

    if (all) {
      log();
      log("[cargo clean in contracts/]");
      const cargoDir = resolve(repoRoot, "contracts");
      if (existsSync(cargoDir)) {
        const cmd = process.platform === "win32" ? "cargo.cmd" : "cargo";
        const manifest = join(cargoDir, "Cargo.toml");
        const args = ["clean", "--manifest-path", manifest];
        log(`  ${cmd} ${args.join(" ")}`);
        const r = spawnSync(cmd, args, { stdio: "inherit", cwd: cargoDir });
        if (r.status === 0) removed++;
        else warn("  cargo clean exited with code", r.status);
      }

      log();
      log("[node_modules (root + all workspaces)]");
      removed += collectAndRemoveDirs("node_modules");
    }

    log();
    log(`Done (cleaned ${removed} entries).`);
    return removed;
  }

  return { run, CLEAN_DIRS, rmIfExists };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const ALL = process.argv.includes("--all");
  createCleaner(DEFAULT_REPO_ROOT, { all: ALL }).run();
  if (ALL) {
    console.log();
    console.log("Full reinstall + rebuild required:");
    console.log("  npm install");
    console.log("Then per README:");
    console.log("  (circuits)  npm run compile   # or bash scripts/compile.sh");
    console.log("  (app)       npm run sync-circuit");
    console.log("  (contracts) cargo build --manifest-path contracts/Cargo.toml");
  }
}
