#!/usr/bin/env node
// Fails if @stellar/stellar-sdk is declared with different version ranges
// across workspaces, so a partial bump can't silently install two SDK copies.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { checkDependencyVersions } from "../repo-structure.mjs";

const DEP = "@stellar/stellar-sdk";

/**
 * Every workspace must declare @stellar/stellar-sdk at the same range, so a
 * partial bump can't silently install two SDK copies.
 *
 * The policy itself lives in `checkDependencyVersions` (scripts/repo-structure.mjs)
 * so `scripts/repo-structure.test.mjs` can assert the same rule for vitest and
 * typescript without a second implementation drifting out of sync.
 */
export function checkSdkVersions(manifests) {
  return checkDependencyVersions(manifests, DEP, Object.keys(manifests));
}

function main() {
  const WORKSPACES = ["app", "packages/client", "scripts"];
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
