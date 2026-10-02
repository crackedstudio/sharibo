import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanContent } from "./maintenance/check-secrets.mjs";
import { STELLAR_SECRET_KEY_PATTERN } from "./maintenance/secret-patterns.mjs";

// Fixture shapes — assert lengths so a one-char-short fixture cannot disarm the test.
const SECRET_KEY = "SCZANGBA5YHTNYVVV4C3U252E2B3P3XXSP22A56DGCOBMBQSGCITBQRT";
const CONTRACT_ID = "CB64IZIBBSPUY63UMIVACKWDKRFNH6WJ2EPAOLM7QR4ZI6IJOT4N2LCF";
const TX_HASH = "2258397474e3ad420d6dd8310cb0976d270c29ec4a4ec2b60a9ae58408088087";
const LOWERCASE = "sczangba5yhtnyvvv4c3u252e2b3p3xxsp22a56dgcobmbqsgcitbqrt";
const TRUNCATED = "SCZANGBA5YHTNYVVV4C3U252E2B3P3XXSP22A56DGCOBMBQSGCITBQR"; // 55 chars

describe("check-secrets fixture shapes", () => {
  it("pins the secret-key fixture at exactly 56 characters", () => {
    assert.equal(SECRET_KEY.length, 56);
    assert.match(SECRET_KEY, /^S[A-Z2-7]{55}$/);
  });

  it("pins the contract-id fixture at 56 characters starting with C", () => {
    assert.equal(CONTRACT_ID.length, 56);
    assert.match(CONTRACT_ID, /^C[A-Z0-9]{55}$/);
  });

  it("pins the truncated fixture below 56 characters", () => {
    assert.equal(TRUNCATED.length, 55);
  });
});

describe("check-secrets scanContent", () => {
  it("fails on a real-shaped 56-char S… secret key", () => {
    const findings = scanContent(`admin=${SECRET_KEY}\n`);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].match, SECRET_KEY);
  });

  it("does not flag a contract ID (C…, 56 chars)", () => {
    assert.equal(scanContent(CONTRACT_ID).length, 0);
  });

  it("does not flag a transaction hash", () => {
    assert.equal(scanContent(TX_HASH).length, 0);
  });

  it("does not flag lowercase or truncated keys (strict uppercase base-32)", () => {
    assert.equal(scanContent(LOWERCASE).length, 0);
    assert.equal(scanContent(TRUNCATED).length, 0);
  });

  it("shared pattern source matches the scanner", () => {
    STELLAR_SECRET_KEY_PATTERN.lastIndex = 0;
    assert.ok(STELLAR_SECRET_KEY_PATTERN.test(SECRET_KEY));
  });
});
