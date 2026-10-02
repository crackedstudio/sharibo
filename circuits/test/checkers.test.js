/**
 * Failure-path tests for the circuit artifact / Poseidon / setup checkers.
 *
 * These scripts are the supply-chain boundary: their job is to FAIL when
 * something is wrong. Happy-path-only coverage would miss the classic
 * vacuous-pass bug (empty expected hash → silent success).
 */
import { describe, it } from "mocha";
import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  EXIT as ARTIFACT_EXIT,
  hashFile,
  readExpectedHash,
  verifyArtifacts,
} from "../scripts/verify-artifacts.mjs";
import {
  EXIT as POSEIDON_EXIT,
  checkPoseidonConstants,
  compareConstants,
  parseCircomConstants,
  parseJsPoseidon2,
} from "../scripts/check-poseidon-constants.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, "fixtures");
const artifactFixtures = path.join(fixtures, "artifacts");
const poseidonFixtures = path.join(fixtures, "poseidon");
const scriptsDir = path.join(__dirname, "..", "scripts");

function artifactCase(name) {
  const dir = path.join(artifactFixtures, name);
  return [
    {
      name: "verification_key.json",
      filePath: path.join(dir, "verification_key.json"),
      hashPath: path.join(dir, "verification_key.json.sha256"),
    },
  ];
}

describe("verify-artifacts failure paths", () => {
  it("passes with a valid artifact and matching committed hash", () => {
    const result = verifyArtifacts({ artifacts: artifactCase("valid") });
    expect(result).to.deep.equal({ ok: true });
  });

  it("fails with HASH_MISMATCH when the artifact is tampered after hashing", () => {
    const result = verifyArtifacts({ artifacts: artifactCase("tampered") });
    expect(result.ok).to.equal(false);
    expect(result.code).to.equal(ARTIFACT_EXIT.HASH_MISMATCH);
    expect(result.message).to.match(/hash mismatch/i);
  });

  it("fails with HASH_MISMATCH when the committed hash does not match content", () => {
    const result = verifyArtifacts({ artifacts: artifactCase("mismatch-hash") });
    expect(result.ok).to.equal(false);
    expect(result.code).to.equal(ARTIFACT_EXIT.HASH_MISMATCH);
    expect(result.message).to.match(/hash mismatch/i);
  });

  it("fails with MISSING_HASH when no committed hash file exists", () => {
    const result = verifyArtifacts({ artifacts: artifactCase("missing-hash"), manifest: {} });
    expect(result.ok).to.equal(false);
    expect(result.code).to.equal(ARTIFACT_EXIT.MISSING_HASH);
    expect(result.message).to.match(/No committed SHA-256 hash found/i);
  });

  it("fails with MALFORMED_HASH when the hash file is truncated/garbage", () => {
    const result = verifyArtifacts({ artifacts: artifactCase("malformed-hash") });
    expect(result.ok).to.equal(false);
    expect(result.code).to.equal(ARTIFACT_EXIT.MALFORMED_HASH);
    expect(result.message).to.match(/malformed/i);
  });

  it("fails with MALFORMED_HASH for an empty expected-hash file (never vacuous pass)", () => {
    const result = verifyArtifacts({ artifacts: artifactCase("empty-hash") });
    expect(result.ok).to.equal(false);
    expect(result.code).to.equal(ARTIFACT_EXIT.MALFORMED_HASH);
    expect(result.message).to.match(/empty or malformed/i);
  });

  it("fails with MISSING_ARTIFACT when the artifact file is absent", () => {
    const result = verifyArtifacts({
      artifacts: [
        {
          name: "verification_key.json",
          filePath: path.join(artifactFixtures, "does-not-exist.json"),
          hashPath: path.join(artifactFixtures, "valid", "verification_key.json.sha256"),
        },
      ],
    });
    expect(result.ok).to.equal(false);
    expect(result.code).to.equal(ARTIFACT_EXIT.MISSING_ARTIFACT);
  });

  it("readExpectedHash rejects empty and missing files distinctly", () => {
    expect(readExpectedHash(path.join(artifactFixtures, "empty-hash", "verification_key.json.sha256"))).to.deep.equal({
      ok: false,
      reason: "malformed",
    });
    expect(readExpectedHash(path.join(artifactFixtures, "missing-hash", "verification_key.json.sha256"))).to.deep.equal({
      ok: false,
      reason: "missing",
    });
    const good = readExpectedHash(path.join(artifactFixtures, "valid", "verification_key.json.sha256"));
    expect(good.ok).to.equal(true);
    expect(good.hash).to.equal(
      hashFile(path.join(artifactFixtures, "valid", "verification_key.json")),
    );
  });
});

describe("check-poseidon-constants failure paths", () => {
  const fakeVersions = {
    js: { raw: "1.0.2", major: 1, minor: 0, patch: 2 },
    circom: { raw: "1.0.0", major: 1, minor: 0, patch: 0 },
  };

  it("passes when fixture constants match (one-limb identity)", () => {
    const circom = parseCircomConstants(path.join(poseidonFixtures, "constants_ok.circom"));
    const js = parseJsPoseidon2(path.join(poseidonFixtures, "poseidon2_ok.ts"));
    const result = compareConstants(circom, js);
    expect(result).to.deep.equal({ ok: true });
  });

  it("fails with CONSTANT_MISMATCH when one Poseidon limb differs", () => {
    const result = checkPoseidonConstants({
      circomConstantsPath: path.join(poseidonFixtures, "constants_altered.circom"),
      jsPoseidon2Path: path.join(poseidonFixtures, "poseidon2_ok_for_altered.ts"),
      jsPkg: fakeVersions.js,
      circomPkg: fakeVersions.circom,
    });
    expect(result.ok).to.equal(false);
    expect(result.code).to.equal(POSEIDON_EXIT.CONSTANT_MISMATCH);
    expect(result.message).to.match(/MISMATCH ROUND_CONSTANTS/i);
  });

  it("fails with VERSION_MISMATCH when major.minor families diverge", () => {
    const result = checkPoseidonConstants({
      circomConstantsPath: path.join(poseidonFixtures, "constants_ok.circom"),
      jsPoseidon2Path: path.join(poseidonFixtures, "poseidon2_ok.ts"),
      jsPkg: { raw: "2.0.0", major: 2, minor: 0, patch: 0 },
      circomPkg: fakeVersions.circom,
    });
    expect(result.ok).to.equal(false);
    expect(result.code).to.equal(POSEIDON_EXIT.VERSION_MISMATCH);
    expect(result.message).to.match(/incompatible/i);
  });
});

describe("verify-setup.sh failure paths", () => {
  it("exits 30 with an actionable message when required artifacts are missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sharibo-verify-setup-"));
    try {
      // Copy the script into an empty circuits-like layout so relative paths resolve.
      const scripts = path.join(tmp, "scripts");
      fs.mkdirSync(scripts);
      fs.copyFileSync(path.join(scriptsDir, "verify-setup.sh"), path.join(scripts, "verify-setup.sh"));
      fs.chmodSync(path.join(scripts, "verify-setup.sh"), 0o755);

      const result = spawnSync("bash", [path.join(scripts, "verify-setup.sh")], {
        encoding: "utf8",
      });
      expect(result.status).to.equal(30);
      expect(result.stderr + result.stdout).to.match(/missing/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
