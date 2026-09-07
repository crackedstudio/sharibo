#!/usr/bin/env node
// Fails if @stellar/stellar-sdk is declared with different version ranges
// across workspaces, so a partial bump can't silently install two SDK copies.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEP = "@stellar/stellar-sdk";
const WORKSPACES = ["app", "packages/client", "scripts"];
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const versions = new Map();
let missing = false;

for (const ws of WORKSPACES) {
  const pkgPath = path.join(repoRoot, ws, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const range = pkg.dependencies?.[DEP] ?? pkg.devDependencies?.[DEP];
  if (!range) {
    console.error(`✗ ${ws}/package.json does not declare ${DEP}`);
    missing = true;
    continue;
  }
  versions.set(ws, range);
}

const distinct = new Set(versions.values());

if (missing || distinct.size > 1) {
  console.error(`✗ ${DEP} version mismatch across workspaces:`);
  for (const [ws, range] of versions) console.error(`  ${ws}: ${range}`);
  console.error(`All workspaces must declare the same version range. Bump ${DEP} in all three places at once.`);
  process.exit(1);
}

console.log(`✓ ${DEP} is pinned to ${[...distinct][0]} across ${[...versions.keys()].join(", ")}`);
