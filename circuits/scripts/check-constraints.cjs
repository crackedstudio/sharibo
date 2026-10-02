#!/usr/bin/env node
/**
 * Constraint-count guard across every guarded Merkle depth (issue #536).
 *
 * `circuits/test/membership.test.js` runs this check for the *one* depth the
 * suite is configured for (circuits/config.json, overridable with LEVELS). That
 * leaves the other guarded depths — the ones anyone evaluating a larger circle
 * actually cares about (issue #267) — unchecked, because a guard that silently
 * skips an unrecorded key is not a guard. This script closes that gap: it
 * recompiles at EVERY depth in GUARDED_DEPTHS and fails if
 * circuits/constraints.json does not record a matching count.
 *
 * It is deliberately independent of the mocha suite so it can run in CI as a
 * fast standalone gate: a plain `circom --r1cs` (no --wasm, no trusted setup)
 * compiles in a few hundred milliseconds per depth, so checking all four costs
 * about a second.
 *
 *   node scripts/check-constraints.cjs
 *
 * Exits non-zero on any missing entry, unexpected key, or count drift.
 */
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CIRCUITS_DIR = path.join(__dirname, "..");
const CONSTRAINTS_PATH = path.join(CIRCUITS_DIR, "constraints.json");

/**
 * The depths this guard is responsible for. This is the *source of truth for
 * what is guarded* — the keys of constraints.json are not, because iterating
 * over the file's own keys would let a deleted entry shrink the guard's own
 * remit without anyone noticing. circuits/test/membership.test.js asserts that
 * constraints.json holds exactly this set, so the two files cannot drift apart
 * in either direction.
 */
const GUARDED_DEPTHS = [4, 8, 16, 20];

/**
 * The compiler the committed counts were produced by. Not a hard requirement
 * (the guard still runs on any circom >= 2.1.6, which is what scripts/compile.sh
 * demands) but a mismatch is worth shouting about: the counts are compiler-
 * version-specific — the depth-4 total moved 3756 -> 3757 between circom 2.1.6
 * and 2.2.3 with no edit to membership.template.circom — so drift under a
 * different compiler is far more likely to be the compiler than the circuit.
 * Kept in step with the pin in .github/workflows/circuits.yml.
 */
const PINNED_CIRCOM = "2.2.3";

function circomVersion() {
  // Same wording as scripts/compile.sh, which is what contributors are already
  // pointed at when a circom problem turns up. `command -v` exits non-zero when
  // the binary is absent, which is the signal here — not a failure to swallow.
  let found = false;
  try {
    execFileSync("sh", ["-c", "command -v circom"], { stdio: "pipe" });
    found = true;
  } catch {
    found = false;
  }
  if (!found) {
    throw new Error(
      "circom not found. Install circom 2.1.6+ from " +
        "https://docs.circom.io/getting-started/installation/ (CI pins " +
        `${PINNED_CIRCOM}, which is what the committed counts were measured with).`,
    );
  }
  const raw = execFileSync("circom", ["--version"], { stdio: "pipe" }).toString();
  const version = /(\d+\.\d+\.\d+)/.exec(raw)?.[1];
  if (!version) {
    throw new Error(
      `Could not parse the circom version from \`circom --version\` (${raw.trim()}). ` +
        `Install circom 2.1.6+ from https://docs.circom.io/getting-started/installation/.`,
    );
  }
  return version;
}

function readCommitted() {
  try {
    return JSON.parse(fs.readFileSync(CONSTRAINTS_PATH, "utf8"));
  } catch (err) {
    throw new Error(`could not read ${CONSTRAINTS_PATH}: ${err.message}`);
  }
}

function compileAtDepth(levels, outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  execFileSync("node", [path.join(CIRCUITS_DIR, "scripts", "gen-circuit.cjs")], {
    cwd: CIRCUITS_DIR,
    env: Object.assign({}, process.env, { LEVELS: String(levels) }),
    stdio: "pipe",
  });

  try {
    execFileSync(
      "circom",
      [
        "membership.circom",
        "--r1cs",
        "--prime",
        "bls12381",
        "-l",
        path.join("..", "node_modules"),
        "-o",
        outDir,
      ],
      { cwd: CIRCUITS_DIR, stdio: "pipe" },
    );
  } catch (err) {
    const detail = (err.stderr || "").toString().trim();
    throw new Error(`circom failed at depth ${levels}${detail ? `:\n${detail}` : ""}`);
  }

  return path.join(outDir, "membership.r1cs");
}

/** Raw R1CS constraint count (linear + non-linear), as `snarkjs r1cs info` reports it. */
async function countConstraints(r1csPath) {
  const snarkjs = require("snarkjs");
  const info = await snarkjs.r1cs.info(r1csPath);
  // readR1cs() spawns worker_threads for field arithmetic; without terminating
  // them the process never exits.
  await info.curve.terminate();
  return Number(info.nConstraints);
}

async function checkConstraints() {
  const version = circomVersion();
  const compiledWith =
    ` (measured with circom ${version}` +
    `${version === PINNED_CIRCOM ? "" : `; committed counts are from circom ${PINNED_CIRCOM}`})`;

  const committed = readCommitted();
  const failures = [];

  const committedKeys = Object.keys(committed).sort();
  const expectedKeys = GUARDED_DEPTHS.map(String).sort();
  for (const key of committedKeys) {
    if (!expectedKeys.includes(key)) {
      failures.push(
        `circuits/constraints.json records depth ${key}, which is not in GUARDED_DEPTHS ` +
          `(${GUARDED_DEPTHS.join(", ")}). Add it to GUARDED_DEPTHS in ` +
          `circuits/scripts/check-constraints.cjs so it is actually guarded, or drop the entry.`,
      );
    }
  }

  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sharibo-constraints-"));
  const rows = [];

  try {
    for (const levels of GUARDED_DEPTHS) {
      const key = String(levels);
      const expected = committed[key];

      if (expected === undefined) {
        // Compile anyway so the error message can quote the number to record.
        const actual = await countConstraints(compileAtDepth(levels, path.join(outRoot, key)));
        failures.push(
          `circuits/constraints.json has no committed constraint count for tree depth ${key}. ` +
            `This build's actual count is ${actual}${compiledWith}. Add "${key}": ${actual} to ` +
            `circuits/constraints.json (and ${key} to GUARDED_DEPTHS in ` +
            `circuits/scripts/check-constraints.cjs if it is not there yet).`,
        );
        rows.push({ levels, expected: "—", actual });
        continue;
      }

      const actual = await countConstraints(compileAtDepth(levels, path.join(outRoot, key)));
      rows.push({ levels, expected, actual });
      if (actual !== expected) {
        failures.push(
          `Constraint count for depth ${key} is ${actual}, but circuits/constraints.json ` +
            `commits to ${expected}${compiledWith}. If this change is intentional (circuit ` +
            `edit, Poseidon package bump, etc.), update "${key}": ${expected} to ` +
            `"${key}": ${actual} in circuits/constraints.json, and record the reason in the ` +
            `commit message. If circom was upgraded instead, regenerate every depth's count ` +
            `under the new compiler and bump the pin in .github/workflows/circuits.yml.`,
        );
      }
    }
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }

  const width = Math.max.apply(
    null,
    rows.map((r) => String(r.levels).length),
  );
  console.log(`Merkle depth  capacity   constraints (committed / actual)  [circom ${version}]`);
  if (version !== PINNED_CIRCOM) {
    console.log(
      `⚠  circom ${PINNED_CIRCOM} is the version the committed counts were measured ` +
        `with; this run used ${version}. A DRIFT below may be the compiler, not the circuit.`,
    );
  }
  for (const r of rows) {
    const ok = r.expected === r.actual;
    console.log(
      `${String(r.levels).padStart(width)}        ${String(2 ** r.levels).padStart(
        9,
      )}   ${String(r.expected).padStart(10)} / ${String(r.actual).padStart(6)}  ${
        ok ? "ok" : "DRIFT"
      }`,
    );
  }

  if (failures.length > 0) {
    console.error("");
    for (const f of failures) console.error(`✗ ${f}`);
    return false;
  }
  console.log(`\nAll ${GUARDED_DEPTHS.length} guarded depths match circuits/constraints.json.`);
  return true;
}

module.exports = { GUARDED_DEPTHS, checkConstraints };

if (require.main === module) {
  checkConstraints().then(
    (ok) => process.exit(ok ? 0 : 1),
    (err) => {
      console.error(`✗ ${err.message}`);
      process.exit(1);
    },
  );
}
