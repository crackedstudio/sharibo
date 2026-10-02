/**
 * Supply-chain boundary for ZK circuit artifacts.
 *
 * Guarantees: every shipped artifact (verification_key.json, membership.wasm,
 * membership_final.zkey) matches a committed SHA-256. Threat addressed: a
 * substituted .zkey whose toxic waste an attacker holds, or a swapped wasm
 * that proves a different statement than the on-chain vk expects.
 *
 * Exit codes (distinguishable by cause for sync-circuit.mjs / CI):
 *   0  — all artifacts verified
 *  10  — artifact file missing
 *  11  — no committed hash found (missing hash file and no manifest entry)
 *  12  — hash mismatch (tampered or rebuilt without updating hash)
 *  13  — hash file present but empty / malformed (must never pass vacuously)
 *  14  — unexpected failure
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXIT = Object.freeze({
  OK: 0,
  MISSING_ARTIFACT: 10,
  MISSING_HASH: 11,
  HASH_MISMATCH: 12,
  MALFORMED_HASH: 13,
  OTHER: 14,
});

const fixHint = "run `npm run compile && npm run setup` in `circuits/`";

export function defaultArtifacts(circuitsDir) {
  return [
    {
      name: "verification_key.json",
      filePath: path.join(circuitsDir, "verification_key.json"),
      hashPath: path.join(circuitsDir, "verification_key.json.sha256"),
    },
    {
      name: "membership.wasm",
      filePath: path.join(circuitsDir, "build", "membership_js", "membership.wasm"),
      hashPath: path.join(circuitsDir, "membership.wasm.sha256"),
    },
    {
      name: "membership_final.zkey",
      filePath: path.join(circuitsDir, "build", "membership_final.zkey"),
      hashPath: path.join(circuitsDir, "membership_final.zkey.sha256"),
    },
  ];
}

export function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/**
 * Parse an expected hash from a committed sidecar file.
 * Returns { ok: true, hash } or { ok: false, reason: "missing"|"malformed" }.
 * An empty or unparseable file is ALWAYS a failure — never a vacuous pass.
 */
export function readExpectedHash(hashPath) {
  if (!existsSync(hashPath)) {
    return { ok: false, reason: "missing" };
  }

  const raw = readFileSync(hashPath, "utf8").trim();
  if (raw.length === 0) {
    return { ok: false, reason: "malformed" };
  }

  const match = raw.match(/^[A-Fa-f0-9]{64}$/) ?? raw.match(/\b([A-Fa-f0-9]{64})\b/);
  if (match) {
    return { ok: true, hash: (match[1] ?? match[0]).toLowerCase() };
  }

  try {
    const parsed = JSON.parse(raw);
    const candidates = [
      parsed.sha256,
      parsed.hash,
      parsed["verification_key.json"],
      parsed["membership.wasm"],
      parsed["membership_final.zkey"],
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && /^[A-Fa-f0-9]{64}$/i.test(candidate.trim())) {
        return { ok: true, hash: candidate.trim().toLowerCase() };
      }
    }
  } catch {
    // fall through to malformed
  }

  return { ok: false, reason: "malformed" };
}

/**
 * Verify a list of artifacts against committed hashes.
 * @returns {{ ok: true } | { ok: false, code: number, message: string }}
 */
export function verifyArtifacts({ artifacts, manifest = {} }) {
  for (const artifact of artifacts) {
    if (!existsSync(artifact.filePath)) {
      return {
        ok: false,
        code: EXIT.MISSING_ARTIFACT,
        message: `${artifact.name} is missing. ${fixHint}`,
      };
    }

    const fromFile = artifact.hashPath
      ? readExpectedHash(artifact.hashPath)
      : { ok: false, reason: "missing" };

    if (fromFile.ok === false && fromFile.reason === "malformed") {
      return {
        ok: false,
        code: EXIT.MALFORMED_HASH,
        message: `Committed hash file for ${artifact.name} is empty or malformed. ${fixHint}`,
      };
    }

    const expected =
      (fromFile.ok ? fromFile.hash : null) ??
      (typeof manifest[artifact.name] === "string" ? manifest[artifact.name].toLowerCase() : null);

    if (!expected) {
      return {
        ok: false,
        code: EXIT.MISSING_HASH,
        message: `No committed SHA-256 hash found for ${artifact.name}. ${fixHint}`,
      };
    }

    if (!/^[a-f0-9]{64}$/.test(expected)) {
      return {
        ok: false,
        code: EXIT.MALFORMED_HASH,
        message: `Committed hash for ${artifact.name} is malformed. ${fixHint}`,
      };
    }

    const actual = hashFile(artifact.filePath);
    if (actual !== expected) {
      return {
        ok: false,
        code: EXIT.HASH_MISMATCH,
        message: `${artifact.name} hash mismatch. Expected ${expected} but found ${actual}. ${fixHint}`,
      };
    }
  }

  return { ok: true };
}

export function loadManifest(circuitsDir) {
  const manifestPath = path.join(circuitsDir, "artifact-hashes.json");
  if (!existsSync(manifestPath)) return {};
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return {};
  }
}

export function runVerify(circuitsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  const result = verifyArtifacts({
    artifacts: defaultArtifacts(circuitsDir),
    manifest: loadManifest(circuitsDir),
  });

  if (!result.ok) {
    console.error(`Circuit artifact verification failed: ${result.message}`);
    console.error(`Fix: ${fixHint}`);
    return result.code;
  }

  console.log("Circuit artifacts verified.");
  return EXIT.OK;
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  process.exit(runVerify());
}
