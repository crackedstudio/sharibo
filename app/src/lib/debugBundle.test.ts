/**
 * debugBundle.test.ts
 *
 * Key acceptance criterion from issue #310:
 *   "A test asserts no S... secret seed can appear in the bundle."
 *
 * Additional tests: field-element scalars, markdown formatting, clean bundles.
 */
import { describe, it, expect } from "vitest";
import {
  buildDebugBundle,
  formatBundleAsMarkdown,
  findLeakedSecret,
  REDACT_PATTERNS,
  type BundleInput,
} from "./debugBundle";

// ─── fixtures ────────────────────────────────────────────────────────────────

const CLEAN_INPUT: BundleInput = {
  appVersion: "0.0.0-test",
  network: {
    contractId: "CB64IZIBBSPUY63UMIVACKWDKRFNH6WJ2EPAOLM7QR4ZI6IJOT4N2LCF",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    tokenContractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  },
  circleId: 0n,
  round: 1,
  currentStep: "proving",
  lastError: null,
  fundedCount: 3,
  circleSize: 5,
  pot: 30_000_000n,
  artifactHashes: {
    wasm: "sha256:abc123",
    zkey: "sha256:def456",
  },
  timings: { artifacts: 1100, proving: 34200, submitting: 2900 },
  userAgent: "Mozilla/5.0 (test)",
};

// Real-shaped Stellar secret seed — base-32, starts with S, 56 chars.
const STELLAR_SECRET = "SCECFBGD3WTYXZPFG6BHZWLZJSB7BXPX4VHDOZFXVLGHXCV5GFQABCD";

// A 77-digit decimal field element (BLS12-381 scalar field, just under r).
const FIELD_ELEMENT_SCALAR =
  "52435875175126190479447740508185965837690552500527637822603658699938581184512";

// ─── findLeakedSecret ────────────────────────────────────────────────────────

describe("findLeakedSecret", () => {
  it("returns null for a clean string", () => {
    expect(findLeakedSecret("hello world, circleId: 42, round: 1")).toBeNull();
  });

  it("detects a Stellar secret seed (S + 55 base-32 chars)", () => {
    const result = findLeakedSecret(`some text ${STELLAR_SECRET} more text`);
    expect(result).not.toBeNull();
    expect(result).toBe(REDACT_PATTERNS[0]);
  });

  it("detects a 77-digit field-element scalar", () => {
    const result = findLeakedSecret(`nullifier: ${FIELD_ELEMENT_SCALAR}`);
    expect(result).not.toBeNull();
    expect(result).toBe(REDACT_PATTERNS[1]);
  });

  it("does not false-positive on a short decimal number", () => {
    expect(findLeakedSecret("circleId: 12345678")).toBeNull();
  });

  it("does not false-positive on a contract ID starting with C", () => {
    expect(
      findLeakedSecret("CB64IZIBBSPUY63UMIVACKWDKRFNH6WJ2EPAOLM7QR4ZI6IJOT4N2LCF"),
    ).toBeNull();
  });
});

// ─── buildDebugBundle — secret exclusion (acceptance criterion) ─────────────

describe("buildDebugBundle — no secrets in bundle", () => {
  it("builds a clean bundle without throwing", () => {
    expect(() => buildDebugBundle(CLEAN_INPUT)).not.toThrow();
  });

  it("serialised bundle contains no Stellar secret seed", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    const serialised = JSON.stringify(bundle);
    expect(serialised).not.toMatch(/S[A-Z2-7]{55}/);
  });

  it("serialised bundle contains no 77-digit field-element scalar", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    const serialised = JSON.stringify(bundle);
    expect(serialised).not.toMatch(/\b\d{77,}\b/);
  });

  it("throws when a Stellar secret seed is injected into a field", () => {
    // Simulate an accidental inclusion — e.g. lastError surfacing a secret.
    const poisoned: BundleInput = {
      ...CLEAN_INPUT,
      lastError: `Failed: key is ${STELLAR_SECRET}`,
    };
    expect(() => buildDebugBundle(poisoned)).toThrow(/Secret material leaked/);
  });

  it("throws when a field-element scalar is injected into a field", () => {
    const poisoned: BundleInput = {
      ...CLEAN_INPUT,
      lastError: `identityNullifier=${FIELD_ELEMENT_SCALAR}`,
    };
    expect(() => buildDebugBundle(poisoned)).toThrow(/Secret material leaked/);
  });

  it("pot is serialised as a string, not a raw bigint", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    expect(typeof bundle.potStroops).toBe("string");
    expect(bundle.potStroops).toBe("30000000");
  });

  it("circleId is serialised as a string", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    expect(typeof bundle.circleId).toBe("string");
    expect(bundle.circleId).toBe("0");
  });

  it("circleId is null when not yet created", () => {
    const bundle = buildDebugBundle({ ...CLEAN_INPUT, circleId: null });
    expect(bundle.circleId).toBeNull();
  });
});

// ─── buildDebugBundle — field pass-through ───────────────────────────────────

describe("buildDebugBundle — field values", () => {
  it("includes the network contract ID", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    expect(bundle.network.contractId).toBe(CLEAN_INPUT.network.contractId);
  });

  it("includes the rpc URL", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    expect(bundle.network.rpcUrl).toBe(CLEAN_INPUT.network.rpcUrl);
  });

  it("includes round, step, fundedCount, circleSize", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    expect(bundle.round).toBe(1);
    expect(bundle.currentStep).toBe("proving");
    expect(bundle.fundedCount).toBe(3);
    expect(bundle.circleSize).toBe(5);
  });

  it("includes artifact hashes verbatim", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    expect(bundle.artifactHashes).toEqual({ wasm: "sha256:abc123", zkey: "sha256:def456" });
  });

  it("includes timings verbatim", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    expect(bundle.timings).toEqual({ artifacts: 1100, proving: 34200, submitting: 2900 });
  });

  it("includes collectedAt as an ISO-8601 timestamp", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    expect(() => new Date(bundle.collectedAt).toISOString()).not.toThrow();
  });
});

// ─── formatBundleAsMarkdown ───────────────────────────────────────────────────

describe("formatBundleAsMarkdown", () => {
  it("starts with the expected heading", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    const md = formatBundleAsMarkdown(bundle);
    expect(md.trimStart()).toMatch(/^### Sharibo debug bundle/);
  });

  it("contains the contract ID", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    const md = formatBundleAsMarkdown(bundle);
    expect(md).toContain(CLEAN_INPUT.network.contractId);
  });

  it("contains the circle id", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    const md = formatBundleAsMarkdown(bundle);
    expect(md).toContain("circle id:    0");
  });

  it("contains the funded count and circle size", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    const md = formatBundleAsMarkdown(bundle);
    expect(md).toContain("funded:       3 / 5");
  });

  it("contains the current step", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    const md = formatBundleAsMarkdown(bundle);
    expect(md).toContain("current step: proving");
  });

  it("shows '(idle)' when currentStep is null", () => {
    const bundle = buildDebugBundle({ ...CLEAN_INPUT, currentStep: null });
    const md = formatBundleAsMarkdown(bundle);
    expect(md).toContain("current step: (idle)");
  });

  it("shows '_none_' for lastError when null", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    const md = formatBundleAsMarkdown(bundle);
    expect(md).toContain("_none_");
  });

  it("includes the lastError text when present", () => {
    const bundle = buildDebugBundle({ ...CLEAN_INPUT, lastError: "RPC timeout" });
    const md = formatBundleAsMarkdown(bundle);
    expect(md).toContain("RPC timeout");
  });

  it("contains timing entries", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    const md = formatBundleAsMarkdown(bundle);
    expect(md).toContain("proving: 34200ms");
  });

  it("pastes cleanly — no lone backtick fences are left open", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    const md = formatBundleAsMarkdown(bundle);
    // Count opening and closing triple-backtick fences — must be balanced.
    const fences = (md.match(/^```/gm) ?? []).length;
    expect(fences % 2).toBe(0);
  });

  it("contains no Stellar secret seed in the output", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    const md = formatBundleAsMarkdown(bundle);
    expect(md).not.toMatch(/S[A-Z2-7]{55}/);
  });
});
