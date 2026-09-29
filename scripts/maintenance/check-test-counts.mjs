#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

function main() {
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const filesToCheck = [
    "README.md",
    "full_product_breakdown.md",
    "docs/threat-model.md"
  ];
  
  let failed = false;
  
  // Look for patterns like "5/5" or "8/8" that are used as test counts
  // Avoid flagging paths or dates (e.g. 2026/09/29) or legit 0/1 fractions
  const countRegex = /(?:^|\s|\*\*|\||\()(\d+)\/(\d+)(?:\*\*|\||\)|\s|$)/g;

  for (const file of filesToCheck) {
    const filePath = path.join(repoRoot, file);
    let content;
    try {
      content = readFileSync(filePath, "utf8");
    } catch (err) {
      console.warn(`Skipping missing file: ${file}`);
      continue;
    }
    
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      while ((match = countRegex.exec(line)) !== null) {
        // Known exceptions that aren't test counts
        if (line.includes("http")) continue; // urls
        if (match[0].includes("0/1")) continue; // "0/1" used for pathIndices
        if (match[0].includes("1/5") || match[0].includes("2/5")) continue; // "[1/5] funded"
        
        // If we find an N/N pattern and the line contains "test", "passing", or is a known old count
        const fraction = `${match[1]}/${match[2]}`;
        const lLine = line.toLowerCase();
        if (["5/5", "6/6", "8/8"].includes(fraction) || lLine.includes("test") || lLine.includes("passing") || lLine.includes("contract") || lLine.includes("circuit")) {
          console.error(`✗ ${file}:${i + 1} contains hardcoded test count: ${fraction}`);
          console.error(`  Line: ${line.trim()}`);
          failed = true;
        }
      }
    }
  }

  if (failed) {
    console.error("\n✗ Hardcoded test counts (like 8/8) are banned in docs to prevent drift. Use descriptions or 'passing'.");
    process.exit(1);
  } else {
    console.log("✓ No hardcoded test counts found in docs.");
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}
