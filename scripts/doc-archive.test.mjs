import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isArchivedDoc, ARCHIVED_DOC_GLOBS, ARCHIVED_DOC_NOTICE } from "./doc-archive.mjs";

describe("doc-archive exclusion", () => {
  it("marks docs/hackathon paths as archived", () => {
    assert.equal(isArchivedDoc("docs/hackathon/VERIFY.md"), true);
    assert.equal(isArchivedDoc("docs/hackathon/dorahacks_submission.md"), true);
    assert.equal(isArchivedDoc("docs/index.md"), false);
    assert.equal(isArchivedDoc("README.md"), false);
  });

  it("exports an explicit glob allowlist and notice marker", () => {
    assert.ok(ARCHIVED_DOC_GLOBS.includes("docs/hackathon/**"));
    assert.match(ARCHIVED_DOC_NOTICE, /Point-in-time archive/);
  });
});
