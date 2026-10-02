// Proof-generation benchmark (Issue #64 and #533).
//
// Usage (from packages/client, after building the circuits per
// circuits/README.md — `npm run bench:prove`):
//
//   npm run bench:prove
//   npm run bench:prove -- --n 10
//
// Generates N proofs against the built circuit artifacts
// (circuits/build/membership_js/membership.wasm,
// circuits/build/membership_final.zkey) using the same input for every run
// (circuits/input.example.json), and reports min/median/max wall time plus
// peak RSS, alongside the Node version and CPU model.

import { readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as snarkjs from "snarkjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CIRCUITS_DIR = path.resolve(__dirname, "../../../circuits");
const WASM_PATH = path.join(CIRCUITS_DIR, "build/membership_js/membership.wasm");
const ZKEY_PATH = path.join(CIRCUITS_DIR, "build/membership_final.zkey");
const VKEY_PATH = path.join(CIRCUITS_DIR, "build/verification_key.json");
const INPUT_PATH = path.join(CIRCUITS_DIR, "input.example.json");
const CONFIG_PATH = path.join(CIRCUITS_DIR, "config.json");
const CONSTRAINTS_PATH = path.join(CIRCUITS_DIR, "build/constraints.json");
const BENCHMARKS_MD = path.join(__dirname, "../BENCHMARKS.md");

const perf =
  typeof globalThis.performance !== "undefined" ? globalThis.performance : { now: () => 0 };

function parseArgN(): number {
  const idx = process.argv.indexOf("--n");
  if (idx !== -1 && process.argv[idx + 1]) {
    const n = Number(process.argv[idx + 1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 5;
}

function loadInput() {
  const raw = JSON.parse(readFileSync(INPUT_PATH, "utf8"));
  return {
    identityNullifier: BigInt(raw.identityNullifier).toString(),
    identitySecret: BigInt(raw.identitySecret).toString(),
    pathElements: raw.pathElements.map((e: string) => BigInt(e).toString()),
    pathIndices: raw.pathIndices,
    root: BigInt(raw.root).toString(),
    externalNullifier: BigInt(raw.externalNullifier).toString(),
  };
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  const n = parseArgN();
  const input = loadInput();

  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  let constraints = "unknown";
  try {
    const c = JSON.parse(readFileSync(CONSTRAINTS_PATH, "utf8"));
    constraints = c.nConstraints || c.constraints || "unknown";
  } catch (e) {
    // If not built yet, handle gracefully.
  }

  const pkgJson = JSON.parse(readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  const snarkjsVersion = pkgJson.dependencies.snarkjs || "unknown";
  const cpuModel = cpus()[0]?.model ?? "unknown";

  console.log(`Node: ${process.version}`);
  console.log(`CPU: ${cpuModel} (${cpus().length} cores)`);
  console.log(`snarkjs: ${snarkjsVersion}`);
  console.log(`Generating ${n} proof(s)...`);

  const stats = {
    artifact: [] as number[],
    witness: [] as number[],
    prove: [] as number[],
    verify: [] as number[],
    total: [] as number[],
  };

  let peakRssBytes = 0;

  for (let i = 0; i < n; i++) {
    const startTotal = perf.now();

    // 1. Artifact Load
    const t0 = perf.now();
    const wasm = new Uint8Array(readFileSync(WASM_PATH));
    const zkey = new Uint8Array(readFileSync(ZKEY_PATH));
    const vkey = JSON.parse(readFileSync(VKEY_PATH, "utf8"));
    stats.artifact.push(perf.now() - t0);

    // 2. Witness Generation
    const t1 = perf.now();
    const wtns = { type: "mem" };
    // @ts-ignore
    await snarkjs.wtns.calculate(input, wasm, wtns);
    stats.witness.push(perf.now() - t1);

    // 3. Proof Generation
    const t2 = perf.now();
    // @ts-ignore
    const { proof, publicSignals } = await snarkjs.groth16.prove(zkey, wtns);
    stats.prove.push(perf.now() - t2);

    // 4. Local Verification
    const t3 = perf.now();
    // @ts-ignore
    await snarkjs.groth16.verify(vkey, publicSignals, proof);
    stats.verify.push(perf.now() - t3);

    const elapsed = perf.now() - startTotal;
    stats.total.push(elapsed);
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    console.log(`  run ${i + 1}/${n}: ${elapsed.toFixed(1)} ms`);
  }

  const sort = (arr: number[]) => [...arr].sort((a, b) => a - b);
  const totalSorted = sort(stats.total);
  const artifactSorted = sort(stats.artifact);
  const witnessSorted = sort(stats.witness);
  const proveSorted = sort(stats.prove);
  const verifySorted = sort(stats.verify);

  console.log("\n--- Proof-generation benchmark ---");
  console.log(`n: ${n}`);
  console.log(`min total:    ${totalSorted[0].toFixed(1)} ms`);
  console.log(`median total: ${median(totalSorted).toFixed(1)} ms`);
  console.log(`max total:    ${totalSorted[totalSorted.length - 1].toFixed(1)} ms`);
  console.log(`peak RSS: ${(peakRssBytes / 1024 / 1024).toFixed(1)} MB`);

  const md = `# Client Proving Benchmarks

This file tracks the off-chain client cost (wall-clock time) for proof generation.
Compare with the on-chain costs in [contracts/BENCHMARKS.md](../../contracts/BENCHMARKS.md).
See [README.md §Tests](../../README.md) for instructions on running this locally.

## Environment
- **Date:** ${new Date().toISOString().split("T")[0]}
- **Node:** \`${process.version}\`
- **CPU:** ${cpuModel} (${cpus().length} cores)
- **snarkjs:** \`${snarkjsVersion}\`
- **Circuit Depth:** ${config.levels}
- **Constraints:** ${constraints}

## Benchmarks (n=${n})

| Stage | Median (ms) | Min (ms) | Max (ms) |
|---|---|---|---|
| Artifact Load | ${median(artifactSorted).toFixed(1)} | ${artifactSorted[0].toFixed(1)} | ${artifactSorted[artifactSorted.length - 1].toFixed(1)} |
| Witness Generation | ${median(witnessSorted).toFixed(1)} | ${witnessSorted[0].toFixed(1)} | ${witnessSorted[witnessSorted.length - 1].toFixed(1)} |
| Proof Generation | ${median(proveSorted).toFixed(1)} | ${proveSorted[0].toFixed(1)} | ${proveSorted[proveSorted.length - 1].toFixed(1)} |
| Local Verification | ${median(verifySorted).toFixed(1)} | ${verifySorted[0].toFixed(1)} | ${verifySorted[verifySorted.length - 1].toFixed(1)} |
| **Total Wait** | **${median(totalSorted).toFixed(1)}** | **${totalSorted[0].toFixed(1)}** | **${totalSorted[totalSorted.length - 1].toFixed(1)}** |

*Peak RSS: ${(peakRssBytes / 1024 / 1024).toFixed(1)} MB*
`;

  if (process.env.WRITE_BENCHMARKS) {
    writeFileSync(BENCHMARKS_MD, md);
    console.log(`\nWrote benchmarks to packages/client/BENCHMARKS.md`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
