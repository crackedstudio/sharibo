import { test } from "vitest";
import assert from "node:assert/strict";

import {
  generateIdentity,
  computeExternalNullifier,
  computeNullifierHash,
  type Identity,
} from "./identity.js";

// ── Helpers ──────────────────────────────────────────────────────────

async function nullifierFor(
  identity: Identity,
  circleId: bigint,
  round: bigint,
): Promise<bigint> {
  const externalNullifier = await computeExternalNullifier(circleId, round);
  return computeNullifierHash(identity.identityNullifier, externalNullifier);
}

// ── Issue #268 — the nullifier hash must change when the external
// ── nullifier changes. These are the off-chain twin of the circuit tests
// ── in circuits/test/membership.test.js; the whole replay defence rests on
// ── nullifierHash being different per round and per identity, so the
// ── property is pinned on the SDK side too (nothing here exercises the
// ── circuit, just the Poseidon hashing both sides must agree on).
test("nullifierHash differs when only the external nullifier (round) changes", async () => {
  const identity = generateIdentity();
  const round0 = await nullifierFor(identity, 7n, 0n);
  const round1 = await nullifierFor(identity, 7n, 1n);

  assert.notEqual(round0, round1);
});

test("nullifierHash is deterministic for the same identity + external nullifier", async () => {
  const identity = generateIdentity();
  const first = await nullifierFor(identity, 7n, 0n);
  const second = await nullifierFor(identity, 7n, 0n);

  assert.equal(first, second);
});

test("two different identities produce different nullifierHash for the same external nullifier", async () => {
  const identityA = generateIdentity();
  const identityB = generateIdentity();

  const a = await nullifierFor(identityA, 9n, 1n);
  const b = await nullifierFor(identityB, 9n, 1n);

  assert.notEqual(a, b);
});