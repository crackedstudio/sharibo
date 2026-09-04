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

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const SECRET_KEY_PATTERN = /\bS[A-Z2-7]{55}\b/g;

// Also flag files that look like raw .env dumps (name-based heuristic).
const ENV_LIKE = /^\.env(?:\..+)?$/;

function getStagedFiles() {
  const out = execFileSync("git", [
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
  ]);
  return out
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);
}

function scanFile(filePath) {
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    let match;
    SECRET_KEY_PATTERN.lastIndex = 0;
    while ((match = SECRET_KEY_PATTERN.exec(lines[i])) !== null) {
      findings.push({ line: i + 1, match: match[0], file: filePath });
    }
  }

  return findings;
}

const stagedFiles = getStagedFiles();
let blocked = false;

// 1. Check for .env-style files being committed
for (const file of stagedFiles) {
  if (ENV_LIKE.test(file)) {
    console.error(
      `\x1b[31m[BLOCKED]\x1b[0m Attempted to commit \`${file}\` which looks like an env file.`,
    );
    console.error(
      "  If this is intentional, use `git commit --no-verify` to skip the hook.",
    );
    blocked = true;
  }
}

// 2. Check for secret key patterns in staged file contents
for (const file of stagedFiles) {
  const findings = scanFile(file);
  for (const f of findings) {
    // Mask all but first 4 chars for safety in output
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
