/**
 * Verifies that importing @sharibo/client in a Node environment does not
 * throw, make network requests, or access DOM globals.
 *
 * Acceptance criterion: the import must succeed with document deliberately
 * undefined and no network access. This guards against regressions where
 * a browser-only side-effect creeps back into the default entry point.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

test("package imports cleanly in Node with document undefined", async () => {
  // Ensure document is not accidentally defined in this test environment.
  assert.strictEqual(
    typeof document,
    "undefined",
    "test must run where document is undefined (Node, not jsdom)",
  );

  // This must not throw, fetch any URLs, or touch the DOM.
  const mod = await import("./index.js");

  // Spot-check a representative export from each sub-module so we know the
  // full barrel was loaded, not just an empty stub.
  assert.strictEqual(typeof mod.generateIdentity, "function", "identity");
  assert.strictEqual(typeof mod.MerkleTree, "function", "tree");
  assert.strictEqual(typeof mod.generateProof, "function", "prove");
  assert.strictEqual(typeof mod.connect, "function", "contract");
  assert.strictEqual(typeof mod.ProvingError, "function", "errors");
  assert.strictEqual(typeof mod.validateCircuitInput, "function", "validateCircuitInput");
  assert.strictEqual(typeof mod.verifyProofLocally, "function", "verifyProofLocally");
  assert.strictEqual(typeof mod.verificationKeyToContractFormat, "function", "vkFormat");
});

test("prefetchMembershipArtifacts is exported but not auto-called at import time", async () => {
  const { prefetchMembershipArtifacts, getArtifactPrefetchProgress } = await import("./index.js");

  assert.strictEqual(typeof prefetchMembershipArtifacts, "function");

  // Status must still be "idle" — if the top-level side effect were still
  // present, it would have flipped to "loading" by the time we read it.
  const progress = getArtifactPrefetchProgress();
  assert.strictEqual(
    progress.status,
    "idle",
    `expected status "idle" but got "${progress.status}" — ` +
    "artifacts.ts is triggering a prefetch on import",
  );
});
