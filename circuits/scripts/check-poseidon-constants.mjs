#!/usr/bin/env node
/**
 * Cross-check Poseidon round constants + MDS matrices between:
 *   - poseidon-bls12381-circom (baked into the circuit via poseidon255.circom)
 *   - poseidon-bls12381       (used by the client as poseidon2)
 *
 * Guarantees: the constants the circuit constrains are byte-identical to the
 * constants the client hashes with. Threat addressed: silent cross-implementation
 * drift where browser proofs verify locally but fail on-chain (or vice versa).
 *
 * Exit codes:
 *   0  — constants match
 *  20  — package major.minor version family mismatch
 *  21  — round constant or MDS limb mismatch
 *  22  — parse / structural failure (missing branch, wrong shape)
 *  23  — unexpected failure
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const EXIT = Object.freeze({
  OK: 0,
  VERSION_MISMATCH: 20,
  CONSTANT_MISMATCH: 21,
  PARSE_ERROR: 22,
  OTHER: 23,
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Arity used by membership.circom (`Poseidon255(2)`) and the client (`poseidon2`). */
export const T = 3;

export function resolvePkgFile(pkg, rel) {
  const pkgJson = require.resolve(`${pkg}/package.json`);
  return path.join(path.dirname(pkgJson), rel);
}

export function readPackageVersion(pkg) {
  const pkgJsonPath = require.resolve(`${pkg}/package.json`);
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkgJson.version ?? "");
  if (!versionMatch) {
    throw Object.assign(new Error(`Could not parse ${pkg} version: ${pkgJson.version}`), {
      exitCode: EXIT.PARSE_ERROR,
    });
  }
  return {
    raw: pkgJson.version,
    major: Number(versionMatch[1]),
    minor: Number(versionMatch[2]),
    patch: Number(versionMatch[3]),
  };
}

export function parseHexLiterals(src) {
  const matches = src.match(/0x[0-9a-fA-F]+n?/g) ?? [];
  return matches.map((m) => BigInt(m.replace(/n$/, "")));
}

/** Extract the `return [...]` body for `if (t == N)` / `else if (t == N)` inside a circom function. */
export function extractCircomBranch(src, fnName, t) {
  const fnRe = new RegExp(`function\\s+${fnName}\\s*\\(\\s*t\\s*\\)\\s*\\{`);
  const fnMatch = fnRe.exec(src);
  if (!fnMatch) {
    throw Object.assign(new Error(`circom: function ${fnName}(t) not found`), {
      exitCode: EXIT.PARSE_ERROR,
    });
  }
  const from = fnMatch.index;
  const rest = src.slice(from);
  const nextFn = rest.search(/\nfunction\s+\w+/);
  const body = nextFn === -1 ? rest : rest.slice(0, nextFn);

  const branchRe = new RegExp(
    `(?:if|else if)\\s*\\(\\s*t\\s*==\\s*${t}\\s*\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}`,
  );
  const branch = branchRe.exec(body);
  if (!branch) {
    throw Object.assign(new Error(`circom: ${fnName}(t) has no branch for t == ${t}`), {
      exitCode: EXIT.PARSE_ERROR,
    });
  }
  const ret = /return\s*(\[[\s\S]*?\]);/.exec(branch[1]);
  if (!ret) {
    throw Object.assign(new Error(`circom: ${fnName}(t==${t}) missing return [...]`), {
      exitCode: EXIT.PARSE_ERROR,
    });
  }
  return ret[1];
}

export function parseCircomConstants(constantsPath, t = T) {
  const src = fs.readFileSync(constantsPath, "utf8");
  const roundFlat = parseHexLiterals(extractCircomBranch(src, "CONSTANTS", t));
  const mdsFlat = parseHexLiterals(extractCircomBranch(src, "MATRIX", t));
  if (mdsFlat.length !== t * t) {
    throw Object.assign(
      new Error(`circom MATRIX(t=${t}): expected ${t * t} entries, got ${mdsFlat.length}`),
      { exitCode: EXIT.PARSE_ERROR },
    );
  }
  const mds = [];
  for (let i = 0; i < t; i++) {
    mds.push(mdsFlat.slice(i * t, (i + 1) * t));
  }
  return { roundConstants: roundFlat, mds };
}

export function parseJsPoseidon2(tsPath) {
  const src = fs.readFileSync(tsPath, "utf8");
  const rcMatch = /const ROUND_CONSTANTS\s*=\s*\[([\s\S]*?)\];/.exec(src);
  const mdsMatch = /const MDS_MATRIX\s*=\s*\[([\s\S]*?)\];/.exec(src);
  if (!rcMatch || !mdsMatch) {
    throw Object.assign(
      new Error(`JS: could not find ROUND_CONSTANTS / MDS_MATRIX in ${tsPath}`),
      { exitCode: EXIT.PARSE_ERROR },
    );
  }
  const roundConstants = parseHexLiterals(rcMatch[1]);
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

export function diffFlat(label, a, b, log = console.error) {
  if (a.length !== b.length) {
    log(`MISMATCH ${label}: count circom=${a.length} js=${b.length}`);
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      log(`MISMATCH ${label}[${i}]:\n  circom: ${hex(a[i])}\n  js:     ${hex(b[i])}`);
      return false;
    }
  }
  return true;
}

export function diffMds(a, b, log = console.error) {
  if (a.length !== b.length) {
    log(`MISMATCH MDS: rows circom=${a.length} js=${b.length}`);
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) {
      log(`MISMATCH MDS[${i}]: cols circom=${a[i].length} js=${b[i].length}`);
      return false;
    }
    for (let j = 0; j < a[i].length; j++) {
      if (a[i][j] !== b[i][j]) {
        log(
          `MISMATCH MDS[${i}][${j}]:\n  circom: ${hex(a[i][j])}\n  js:     ${hex(b[i][j])}`,
        );
        return false;
      }
    }
  }
  return true;
}

/**
 * Compare two already-parsed constant sets. Used by fixture tests.
 * @returns {{ ok: true } | { ok: false, code: number, message: string }}
 */
export function compareConstants(circom, js) {
  const messages = [];
  const log = (m) => messages.push(m);
  let ok = true;
  ok = diffFlat("ROUND_CONSTANTS", circom.roundConstants, js.roundConstants, log) && ok;
  ok = diffMds(circom.mds, js.mds, log) && ok;
  if (!ok) {
    return {
      ok: false,
      code: EXIT.CONSTANT_MISMATCH,
      message: messages.join("\n"),
    };
  }
  return { ok: true };
}

export function checkPoseidonConstants({
  circomConstantsPath,
  jsPoseidon2Path,
  jsPkg,
  circomPkg,
} = {}) {
  const js = jsPkg ?? readPackageVersion("poseidon-bls12381");
  const circom = circomPkg ?? readPackageVersion("poseidon-bls12381-circom");

  if (js.major !== circom.major || js.minor !== circom.minor) {
    return {
      ok: false,
      code: EXIT.VERSION_MISMATCH,
      message:
        `Poseidon package versions are incompatible: poseidon-bls12381@${js.raw} and poseidon-bls12381-circom@${circom.raw}. ` +
        "Bump them together in the same commit and keep the same major.minor release family.",
    };
  }

  let circomPath = circomConstantsPath;
  let jsPath = jsPoseidon2Path;

  if (!circomPath || !jsPath) {
    const circomMain = resolvePkgFile("poseidon-bls12381-circom", "circuits/poseidon255.circom");
    const circomDir = path.dirname(circomMain);
    const circomSrc = fs.readFileSync(circomMain, "utf8");
    const includeMatch = /include\s+"(\.\/)?poseidon255_constants\.circom"\s*;/.exec(circomSrc);
    if (!includeMatch) {
      return {
        ok: false,
        code: EXIT.PARSE_ERROR,
        message: `${circomMain} does not include poseidon255_constants.circom`,
      };
    }
    circomPath = circomPath ?? path.join(circomDir, "poseidon255_constants.circom");
    jsPath = jsPath ?? resolvePkgFile("poseidon-bls12381", "src/instances/poseidon2.ts");
  }

  try {
    const circomConsts = parseCircomConstants(circomPath);
    const jsConsts = parseJsPoseidon2(jsPath);
    const compared = compareConstants(circomConsts, jsConsts);
    if (!compared.ok) return compared;

    return {
      ok: true,
      message:
        `Poseidon constants OK (t=${T}): ${circomConsts.roundConstants.length} round constants, ${T}×${T} MDS — circom ↔ poseidon2 match.`,
      versions: { js: js.raw, circom: circom.raw },
    };
  } catch (err) {
    return {
      ok: false,
      code: err.exitCode ?? EXIT.PARSE_ERROR,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function main() {
  try {
    const result = checkPoseidonConstants();
    if (!result.ok) {
      console.error(result.message);
      process.exit(result.code);
    }
    if (result.versions) {
      console.log(
        `Poseidon package compatibility OK: poseidon-bls12381@${result.versions.js} and poseidon-bls12381-circom@${result.versions.circom} share the same release family.`,
      );
    }
    console.log(result.message);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(err.exitCode ?? EXIT.OTHER);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  main();
}
