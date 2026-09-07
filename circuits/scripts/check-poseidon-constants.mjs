#!/usr/bin/env node
/**
 * Cross-check Poseidon round constants + MDS matrices between:
 *   - poseidon-bls12381-circom (baked into the circuit via poseidon255.circom)
 *   - poseidon-bls12381       (used by the client as poseidon2)
 *
 * Compares the arity we actually ship: Poseidon255(2) ↔ poseidon2 (t = 3).
 * Fail-fast with the first mismatched index so a drift is diagnosable at source.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Arity used by membership.circom (`Poseidon255(2)`) and the client (`poseidon2`). */
const T = 3;

function resolvePkgFile(pkg, rel) {
  const pkgJson = require.resolve(`${pkg}/package.json`);
  return path.join(path.dirname(pkgJson), rel);
}

function readPackageVersion(pkg) {
  const pkgJsonPath = require.resolve(`${pkg}/package.json`);
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkgJson.version ?? "");
  if (!versionMatch) {
    throw new Error(`Could not parse ${pkg} version: ${pkgJson.version}`);
  }
  return {
    raw: pkgJson.version,
    major: Number(versionMatch[1]),
    minor: Number(versionMatch[2]),
    patch: Number(versionMatch[3]),
  };
}

function parseHexLiterals(src) {
  const matches = src.match(/0x[0-9a-fA-F]+n?/g) ?? [];
  return matches.map((m) => BigInt(m.replace(/n$/, "")));
}

/** Extract the `return [...]` body for `if (t == N)` / `else if (t == N)` inside a circom function. */
function extractCircomBranch(src, fnName, t) {
  const fnRe = new RegExp(`function\\s+${fnName}\\s*\\(\\s*t\\s*\\)\\s*\\{`);
  const fnMatch = fnRe.exec(src);
  if (!fnMatch) {
    throw new Error(`circom: function ${fnName}(t) not found`);
  }
  const from = fnMatch.index;
  // End at the next top-level `function` or EOF.
  const rest = src.slice(from);
  const nextFn = rest.search(/\nfunction\s+\w+/);
  const body = nextFn === -1 ? rest : rest.slice(0, nextFn);

  const branchRe = new RegExp(
    `(?:if|else if)\\s*\\(\\s*t\\s*==\\s*${t}\\s*\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}`,
  );
  const branch = branchRe.exec(body);
  if (!branch) {
    throw new Error(`circom: ${fnName}(t) has no branch for t == ${t}`);
  }
  const ret = /return\s*(\[[\s\S]*?\]);/.exec(branch[1]);
  if (!ret) {
    throw new Error(`circom: ${fnName}(t==${t}) missing return [...]`);
  }
  return ret[1];
}

function parseCircomConstants(constantsPath) {
  const src = fs.readFileSync(constantsPath, "utf8");
  const roundFlat = parseHexLiterals(extractCircomBranch(src, "CONSTANTS", T));
  const mdsFlat = parseHexLiterals(extractCircomBranch(src, "MATRIX", T));
  if (mdsFlat.length !== T * T) {
    throw new Error(`circom MATRIX(t=${T}): expected ${T * T} entries, got ${mdsFlat.length}`);
  }
  const mds = [];
  for (let i = 0; i < T; i++) {
    mds.push(mdsFlat.slice(i * T, (i + 1) * T));
  }
  return { roundConstants: roundFlat, mds };
}

function parseJsPoseidon2(tsPath) {
  const src = fs.readFileSync(tsPath, "utf8");
  const rcMatch = /const ROUND_CONSTANTS\s*=\s*\[([\s\S]*?)\];/.exec(src);
  const mdsMatch = /const MDS_MATRIX\s*=\s*\[([\s\S]*?)\];/.exec(src);
  if (!rcMatch || !mdsMatch) {
    throw new Error(`JS: could not find ROUND_CONSTANTS / MDS_MATRIX in ${tsPath}`);
  }
  const roundConstants = parseHexLiterals(rcMatch[1]);
  // Row-major: each inner `[...]` is one MDS row.
  const rowRe = /\[([^\[\]]+)\]/g;
  const mds = [];
  let row;
  while ((row = rowRe.exec(mdsMatch[1])) !== null) {
    mds.push(parseHexLiterals(row[1]));
  }
  return { roundConstants, mds };
}

function hex(v) {
  return `0x${v.toString(16)}`;
}

function diffFlat(label, a, b) {
  if (a.length !== b.length) {
    console.error(`MISMATCH ${label}: count circom=${a.length} js=${b.length}`);
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      console.error(`MISMATCH ${label}[${i}]:\n  circom: ${hex(a[i])}\n  js:     ${hex(b[i])}`);
      return false;
    }
  }
  return true;
}

function diffMds(a, b) {
  if (a.length !== b.length) {
    console.error(`MISMATCH MDS: rows circom=${a.length} js=${b.length}`);
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) {
      console.error(`MISMATCH MDS[${i}]: cols circom=${a[i].length} js=${b[i].length}`);
      return false;
    }
    for (let j = 0; j < a[i].length; j++) {
      if (a[i][j] !== b[i][j]) {
        console.error(
          `MISMATCH MDS[${i}][${j}]:\n  circom: ${hex(a[i][j])}\n  js:     ${hex(b[i][j])}`,
        );
        return false;
      }
    }
  }
  return true;
}

function main() {
  const jsPkg = readPackageVersion("poseidon-bls12381");
  const circomPkg = readPackageVersion("poseidon-bls12381-circom");
  if (jsPkg.major !== circomPkg.major || jsPkg.minor !== circomPkg.minor) {
    throw new Error(
      `Poseidon package versions are incompatible: poseidon-bls12381@${jsPkg.raw} and poseidon-bls12381-circom@${circomPkg.raw}. ` +
        "Bump them together in the same commit and keep the same major.minor release family.",
    );
  }

  // Constants live in the file included by poseidon255.circom.
  const circomMain = resolvePkgFile("poseidon-bls12381-circom", "circuits/poseidon255.circom");
  const circomDir = path.dirname(circomMain);
  const circomSrc = fs.readFileSync(circomMain, "utf8");
  const includeMatch = /include\s+"(\.\/)?poseidon255_constants\.circom"\s*;/.exec(circomSrc);
  if (!includeMatch) {
    throw new Error(`${circomMain} does not include poseidon255_constants.circom`);
  }
  const constantsPath = path.join(circomDir, "poseidon255_constants.circom");
  const jsPath = resolvePkgFile("poseidon-bls12381", "src/instances/poseidon2.ts");

  const circom = parseCircomConstants(constantsPath);
  const js = parseJsPoseidon2(jsPath);

  let ok = true;
  ok = diffFlat("ROUND_CONSTANTS", circom.roundConstants, js.roundConstants) && ok;
  ok = diffMds(circom.mds, js.mds) && ok;

  if (!ok) {
    process.exit(1);
  }

  console.log(
    `Poseidon package compatibility OK: poseidon-bls12381@${jsPkg.raw} and poseidon-bls12381-circom@${circomPkg.raw} share the same ${jsPkg.major}.${jsPkg.minor}.x release family.`,
  );
  console.log(
    `Poseidon constants OK (t=${T}): ${circom.roundConstants.length} round constants, ${T}×${T} MDS — circom ↔ poseidon2 match.`,
  );
}

main();
