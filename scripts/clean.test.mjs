import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCleaner } from "./maintenance/clean.mjs";

describe("clean.mjs", () => {
  /** @type {string} */
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "sharibo-clean-"));
    for (const d of [
      "circuits/build",
      "app/public/circuits",
      "app/dist",
      "app/.vite",
      "packages/client/dist",
      "keep-me",
    ]) {
      mkdirSync(join(root, d), { recursive: true });
      writeFileSync(join(root, d, "marker.txt"), "x");
    }
    writeFileSync(join(root, "circuits/membership.circom"), "// generated");
    writeFileSync(join(root, "keep-me/safe.txt"), "stay");
    writeFileSync(join(root, "artifact.zkey"), "z");
    writeFileSync(join(root, "artifact.ptau"), "p");
    mkdirSync(join(root, "circuits"), { recursive: true });
    writeFileSync(join(root, "circuits/verification_key.json"), "{}");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("removes exactly the intended paths and nothing outside them", () => {
    const logs = [];
    const { run, CLEAN_DIRS } = createCleaner(root, {
      all: false,
      log: (...args) => logs.push(args.join(" ")),
    });

    assert.ok(CLEAN_DIRS.includes("packages/client/dist"));
    run();

    for (const d of CLEAN_DIRS) {
      assert.equal(existsSync(join(root, d)), false, `expected removed: ${d}`);
    }
    assert.equal(existsSync(join(root, "circuits/membership.circom")), false);
    assert.equal(existsSync(join(root, "artifact.zkey")), false);
    assert.equal(existsSync(join(root, "artifact.ptau")), false);

    // Outside the clean set — must survive.
    assert.equal(existsSync(join(root, "keep-me/safe.txt")), true);
    assert.equal(readFileSync(join(root, "circuits/verification_key.json"), "utf8"), "{}");
  });
});
