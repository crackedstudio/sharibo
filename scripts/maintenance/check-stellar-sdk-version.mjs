#!/usr/bin/env node
// Fails if @stellar/stellar-sdk is declared with different version ranges
// across workspaces, so a partial bump can't silently install two SDK copies.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEP = "@stellar/stellar-sdk";

export function checkSdkVersions(manifests) {
  /** @type {Map<string, string>} */
  const versions = new Map();
  /** @type {string[]} */
  const missing = [];

  for (const [ws, pkg] of Object.entries(manifests)) {
    const range = pkg.dependencies?.[DEP] ?? pkg.devDependencies?.[DEP];
    if (!range) {
      missing.push(ws);
      continue;
    }
    versions.set(ws, range);
  }

  const distinct = new Set(versions.values());
  const ok = missing.length === 0 && distinct.size <= 1;
  return { ok, versions, missing, distinct: [...distinct] };
}

function main() {
  const WORKSPACES = ["app", "packages/client", "packages/core", "scripts"];
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

  /** @type {Record<string, object>} */
  const manifests = {};
  for (const ws of WORKSPACES) {
    const pkgPath = path.join(repoRoot, ws, "package.json");
    manifests[ws] = JSON.parse(readFileSync(pkgPath, "utf8"));
  }

  const result = checkSdkVersions(manifests);

  for (const ws of result.missing) {
    console.error(`✗ ${ws}/package.json does not declare ${DEP}`);
  }

  if (!result.ok) {
    console.error(`✗ ${DEP} version mismatch across workspaces:`);
    for (const [ws, range] of result.versions) console.error(`  ${ws}: ${range}`);
    console.error(
      `All workspaces must declare the same version range. Bump ${DEP} in all three places at once.`,
    );
    process.exit(1);
  }

  console.log(
    `✓ ${DEP} is pinned to ${result.distinct[0]} across ${[...result.versions.keys()].join(", ")}`,
  );
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
