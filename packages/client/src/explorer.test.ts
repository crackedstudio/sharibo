/**
 * Tests for explorerTxUrl — covers all known networks plus unknown ones
 * to ensure we never emit a silently-wrong URL.
 *
 * The real passphrase strings are the canonical Stellar ones (embedded in
 * @stellar/stellar-sdk as Networks.PUBLIC / Networks.TESTNET / etc.); they
 * are repeated verbatim here so a future rename in the SDK fails the suite
 * rather than silently drifting.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { explorerTxUrl, EXPLORER_NETWORKS } from "./contract.js";

const HASH = "2258397474e3ad420d6dd8310cb0976d270c29ec4a4ec2b60a9ae58408088087";

const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const FUTURENET_PASSPHRASE = "Test SDF Future Network ; October 2022";

// ─── known networks ─────────────────────────────────────────────────────────

test("mainnet passphrase produces a mainnet stellar.expert URL", () => {
  const url = explorerTxUrl(HASH, MAINNET_PASSPHRASE);
  assert.equal(url, `https://stellar.expert/explorer/public/tx/${HASH}`);
});

test("mainnet URL does not contain the word 'testnet'", () => {
  const url = explorerTxUrl(HASH, MAINNET_PASSPHRASE);
  assert.ok(url !== null && !url.includes("testnet"), `expected no 'testnet' in ${url}`);
});

test("testnet passphrase produces a testnet stellar.expert URL", () => {
  const url = explorerTxUrl(HASH, TESTNET_PASSPHRASE);
  assert.equal(url, `https://stellar.expert/explorer/testnet/tx/${HASH}`);
});

test("testnet URL contains 'testnet' path segment, not subdomain", () => {
  // Old implementation used a testnet. subdomain; the new one uses a path segment.
  const url = explorerTxUrl(HASH, TESTNET_PASSPHRASE);
  assert.ok(url !== null, "expected a non-null URL for testnet");
  assert.ok(url.startsWith("https://stellar.expert/"), "expected no subdomain");
  assert.ok(url.includes("/testnet/"), "expected /testnet/ path segment");
});

// ─── unknown / unhosted networks ────────────────────────────────────────────

test("futurenet passphrase returns null — not a testnet URL", () => {
  // This is the key regression: the old includes("Public Global") branch would
  // have fallen through to the testnet case and emitted a wrong URL.
  const url = explorerTxUrl(HASH, FUTURENET_PASSPHRASE);
  assert.equal(url, null, "futurenet must not produce any explorer link");
});

test("arbitrary custom passphrase returns null", () => {
  const url = explorerTxUrl(HASH, "My Private Network ; 2025");
  assert.equal(url, null);
});

test("empty passphrase returns null", () => {
  const url = explorerTxUrl(HASH, "");
  assert.equal(url, null);
});

// ─── EXPLORER_NETWORKS map contract ─────────────────────────────────────────

test("EXPLORER_NETWORKS contains an entry for the real mainnet passphrase", () => {
  assert.ok(
    EXPLORER_NETWORKS.has(MAINNET_PASSPHRASE),
    "EXPLORER_NETWORKS must include the mainnet passphrase",
  );
});

test("EXPLORER_NETWORKS contains an entry for the real testnet passphrase", () => {
  assert.ok(
    EXPLORER_NETWORKS.has(TESTNET_PASSPHRASE),
    "EXPLORER_NETWORKS must include the testnet passphrase",
  );
});

test("EXPLORER_NETWORKS does NOT contain the futurenet passphrase", () => {
  assert.equal(
    EXPLORER_NETWORKS.has(FUTURENET_PASSPHRASE),
    false,
    "futurenet must not appear in EXPLORER_NETWORKS",
  );
});
