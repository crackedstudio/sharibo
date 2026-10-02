#!/usr/bin/env node
// Pre-commit hook: scan staged files for Stellar secret keys.
// Used by scripts/maintenance/install-hooks.sh as an opt-in git hook.
//
// Pattern: Stellar secret keys start with S followed by 55 base32 chars.
// This deliberately excludes C... (contract IDs) and G... (public keys).
//
// Usage (direct):
//   node scripts/maintenance/check-secrets.mjs
//
// The script reads staged files from `git diff --cached` and scans each
// for the secret-key regex. Exit code is 0 (pass) or 1 (blocked).
//
// Testable core is exported via `scanContent` / `scanFile` when imported;
// the CLI side-effect runs only when this file is the process entry point.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COMMIT_SECRET_PATTERNS } from "./secret-patterns.mjs";

const ENV_LIKE = /^\.env(?:\..+)?$/;

export function scanContent(content, filePath = "<memory>") {
  const lines = content.split("\n");
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    for (const pattern of COMMIT_SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(lines[i])) !== null) {
        findings.push({ line: i + 1, match: match[0], file: filePath });
      }
    }
  }

  return findings;
}

const IGNORED_FILES = new Set(["scripts/check-secrets.test.mjs", "scripts/config.test.ts"]);

export function scanFile(filePath) {
  if (!existsSync(filePath) || IGNORED_FILES.has(filePath)) return [];
  return scanContent(readFileSync(filePath, "utf8"), filePath);
}

export function isEnvLike(file) {
  const basename = file.split("/").pop();
  if (basename === ".env.example") return false;
  return ENV_LIKE.test(basename);
}

function getFilesToScan() {
  const args = process.argv.slice(2);
  const allIdx = args.indexOf("--all");
  if (allIdx !== -1) {
    return execFileSync("git", ["ls-files"]).toString().trim().split("\n").filter(Boolean);
  }

  const prIdx = args.indexOf("--pr");
  if (prIdx !== -1 && args[prIdx + 1]) {
    const base = args[prIdx + 1];
    return execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`])
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
  }

  return execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
}

function main() {
  const stagedFiles = getFilesToScan();
  let blocked = false;

  for (const file of stagedFiles) {
    if (isEnvLike(file)) {
      console.error(
        `\x1b[31m[BLOCKED]\x1b[0m Attempted to commit \`${file}\` which looks like an env file.`,
      );
      console.error("  If this is intentional, use `git commit --no-verify` to skip the hook.");
      blocked = true;
    }
  }

  for (const file of stagedFiles) {
    const findings = scanFile(file);
    for (const f of findings) {
      const masked = f.match.slice(0, 4) + "…";
      console.error(
        `\x1b[31m[BLOCKED]\x1b[0m ${f.file}:${f.line} contains a Stellar secret key (${masked}).`,
      );
      blocked = true;
    }
  }

  if (blocked) {
    console.error(
      "\n\x1b[33mCommit blocked.\x1b[0m Remove the secrets above, or if you are certain this is a false positive, run:\n" +
        "  git commit --no-verify\n",
    );
    process.exit(1);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
