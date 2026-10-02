#!/usr/bin/env node
/**
 * check-bundle-budget.mjs — keeps the landing page free of proving code.
 *
 * The landing screen must not ship snarkjs, Poseidon or the Stellar SDK: a
 * visitor who never starts a circle should never download the proving stack
 * (issue #300). `React.lazy` only guarantees that while every SDK import stays
 * behind the lazy boundary, and one stray top-level `import ... from
 * "@sharibo/client"` is enough to silently put ~1.4 MB back on the critical
 * path. This script is the tripwire.
 *
 * How it works: `vite build` writes `dist/.vite/manifest.json`, which records
 * the static (`imports`) and dynamic (`dynamicImports`) edges between chunks.
 * Starting at the `index.html` entry we walk the *static* graph — the files a
 * browser downloads before it can paint the landing screen — and assert:
 *
 *   1. none of those chunks contain proving code (marker strings below), and
 *   2. their total size stays under ENTRY_BUDGET_BYTES.
 *
 * It also asserts the proving code still exists in some *lazy* chunk, so the
 * check can't quietly pass because the SDK stopped being bundled at all.
 *
 * Run `npm run build` first; `npm run check:bundle` is wired into it.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "..", "dist");
const manifestPath = path.join(distDir, ".vite", "manifest.json");

/**
 * Total JS the landing screen may download (raw bytes, pre-gzip).
 *
 * Current entry graph is ~260 kB (React + ReactDOM + the shell), so this
 * leaves headroom for the landing UI to grow but not for anything heavy: the
 * proving stack alone is >1.4 MB, and the pre-split bundle was ~1.5 MB.
 */
const ENTRY_BUDGET_BYTES = 400 * 1024;

/**
 * Distinctive strings that only survive minification inside proving code.
 * All of these are absent from the landing graph today; if one starts showing
 * up there, either an SDK import escaped the lazy boundary or the string moved
 * into copy rendered on the landing screen (in which case move that string out
 * of the entry chunk rather than adding it to an ignore list here).
 */
const FORBIDDEN_MARKERS = [
  "snarkjs", // snarkjs (Groth16 prover)
  "groth16", // snarkjs protocol/curve names
  "poseidon", // poseidon-bls12381 + the client's Merkle commitments
  "XDR Write Error", // @stellar/stellar-sdk (stellar-base)
  "scvBytes", // @stellar/stellar-sdk ScVal codec
  "Curve25519", // @stellar/stellar-sdk key handling
];

function fail(message) {
  console.error(`\n✗ bundle budget: ${message}\n`);
  process.exit(1);
}

if (!existsSync(manifestPath)) {
  fail(
    `no build manifest at ${path.relative(process.cwd(), manifestPath)} — run \`npm run build\` first`,
  );
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const entryKey = Object.keys(manifest).find((key) => key.endsWith("index.html"));
if (!entryKey) {
  fail("build manifest has no index.html entry — is `build.manifest: true` still set in vite.config.ts?");
}

/** Every chunk reachable from `key` by following static `imports` only. */
function staticGraph(key) {
  const seen = new Set();
  const queue = [key];
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current) || !manifest[current]) continue;
    seen.add(current);
    for (const imported of manifest[current].imports ?? []) {
      if (!seen.has(imported)) queue.push(imported);
    }
  }
  return seen;
}

const entryGraph = staticGraph(entryKey);
const filesOf = (keys) => [...keys].map((key) => manifest[key].file).filter(Boolean);

const entryFiles = [...new Set(filesOf(entryGraph))].filter((file) => file.endsWith(".js"));
const lazyFiles = Object.entries(manifest)
  .filter(([key]) => !entryGraph.has(key))
  .map(([, chunk]) => chunk.file)
  .filter((file) => file && file.endsWith(".js"));

let totalBytes = 0;
const violations = [];

for (const file of entryFiles) {
  const fullPath = path.join(distDir, file);
  const bytes = statSync(fullPath).size;
  totalBytes += bytes;

  const source = readFileSync(fullPath, "utf8");
  for (const marker of FORBIDDEN_MARKERS) {
    if (source.includes(marker)) {
      violations.push(`${file} contains proving code ("${marker}")`);
    }
  }
}

if (violations.length > 0) {
  fail(
    [
      "the landing chunk graph must not contain the proving stack:",
      ...violations.map((v) => `    · ${v}`),
      "",
      "  These chunks load before the landing screen paints, so anything here is",
      "  paid for by every visitor. Move the import behind the React.lazy",
      "  boundary in app/src/App.tsx (see app/src/screens/CircleScreen.tsx).",
    ].join("\n"),
  );
}

if (totalBytes > ENTRY_BUDGET_BYTES) {
  fail(
    [
      `the landing chunk graph is ${(totalBytes / 1024).toFixed(1)} kB, over the ${(ENTRY_BUDGET_BYTES / 1024).toFixed(0)} kB budget.`,
      "",
      `  entry chunks: ${entryFiles.join(", ")}`,
      "",
      "  If this is legitimate growth, raise ENTRY_BUDGET_BYTES deliberately in",
      "  app/scripts/check-bundle-budget.mjs — but check first that an SDK import",
      "  hasn't drifted back out of the lazily-loaded circle screen.",
    ].join("\n"),
  );
}

// Guard against a vacuous pass: the proving stack must still be in a lazy
// chunk. If nothing matches, the SDK stopped being bundled at all and this
// check would no longer catch a regression.
const lazyHasProvingCode = lazyFiles.some((file) => {
  const source = readFileSync(path.join(distDir, file), "utf8");
  return FORBIDDEN_MARKERS.some((marker) => source.includes(marker));
});

if (!lazyHasProvingCode) {
  fail(
    [
      "no proving code found in any lazily-loaded chunk.",
      "",
      "  The circle screen is supposed to pull the SDK in dynamically; if that",
      "  stopped happening, this budget check can no longer detect a regression.",
      "  Did the React.lazy boundary in app/src/App.tsx change?",
    ].join("\n"),
  );
}

console.log(
  `✓ bundle budget: landing graph ${entryFiles.length} chunk(s), ` +
    `${(totalBytes / 1024).toFixed(1)} kB / ${(ENTRY_BUDGET_BYTES / 1024).toFixed(0)} kB budget, ` +
    `${lazyFiles.length} lazy chunk(s) hold the proving stack`,
);
