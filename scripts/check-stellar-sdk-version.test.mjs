import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkSdkVersions } from "./maintenance/check-stellar-sdk-version.mjs";

const DEP = "@stellar/stellar-sdk";

describe("check-stellar-sdk-version", () => {
  it("passes when all manifests agree", () => {
    const result = checkSdkVersions({
      app: { dependencies: { [DEP]: "^16.2.0" } },
      "packages/client": { dependencies: { [DEP]: "^16.2.0" } },
      scripts: { dependencies: { [DEP]: "^16.2.0" } },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.distinct, ["^16.2.0"]);
    assert.equal(result.missing.length, 0);
  });

  it("fails when ranges disagree and names both versions", () => {
    const result = checkSdkVersions({
      app: { dependencies: { [DEP]: "^16.2.0" } },
      "packages/client": { dependencies: { [DEP]: "^16.0.1" } },
      scripts: { dependencies: { [DEP]: "^16.2.0" } },
    });
    assert.equal(result.ok, false);
    assert.ok(result.distinct.includes("^16.2.0"));
    assert.ok(result.distinct.includes("^16.0.1"));
  });

  it("fails when a workspace is missing the dependency", () => {
    const result = checkSdkVersions({
      app: { dependencies: { [DEP]: "^16.2.0" } },
      "packages/client": { dependencies: {} },
      scripts: { dependencies: { [DEP]: "^16.2.0" } },
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ["packages/client"]);
  });
});
