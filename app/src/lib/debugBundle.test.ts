/**
 * debugBundle.test.ts
 *
 * Key acceptance criterion from issue #310:
 *   "A test asserts no S... secret seed can appear in the bundle."
 *
 * Additional tests: field-element scalars, markdown formatting, clean bundles.
 *
 * Issue #503: hardened redaction — hex scalars, lowercase Strkeys, muxed
 * addresses, and redact-rather-than-throw for runtime fields.
 */
import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
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
  recentEvents: [
    { type: "rpc:attempt", at: "2026-01-01T00:00:00.000Z" },
    { type: "rpc:retry", at: "2026-01-01T00:00:00.100Z", detail: { attempt: 1, delay: 500, error: "429" } },
  ],
  userAgent: "Mozilla/5.0 (test)",
};

// Real-shaped Stellar secret seed — base-32, starts with S, 56 chars.
// Derived from a generated keypair so it is 56 chars by construction and
// cannot drift out of sync with the REDACT_PATTERNS[0] shape.
const STELLAR_SECRET = Keypair.random().secret();

// A 77-digit decimal field element (BLS12-381 scalar field, just under r).
const FIELD_ELEMENT_SCALAR =
  "52435875175126190479447740508185965837690552500527637822603658699938581184512";

// A 64-hex-char field element (BLS12-381 scalar rendered as hex).
const FIELD_ELEMENT_HEX =
  "0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809";

// A 64-hex-char transaction hash — legitimate, must NOT be flagged.
const TX_HASH =
  "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

// A muxed account Strkey (M + 68 base-32 chars, 69 total).
const MUXED_ACCOUNT =
  "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAAAAAAAAAAAAJLK";

// ─── fixture sanity ──────────────────────────────────────────────────────────

describe("test fixtures", () => {
  it("STELLAR_SECRET is a 56-char Strkey seed (S + 55 base-32 chars)", () => {
    expect(STELLAR_SECRET.length).toBe(56);
    expect(STELLAR_SECRET).toMatch(/^S[A-Z2-7]{55}$/);
  });

  it("FIELD_ELEMENT_SCALAR is a 77-digit decimal", () => {
    expect(FIELD_ELEMENT_SCALAR.length).toBe(77);
    expect(FIELD_ELEMENT_SCALAR).toMatch(/^\d{77}$/);
  });

  it("FIELD_ELEMENT_HEX is a 0x-prefixed 64-hex-char scalar", () => {
    expect(FIELD_ELEMENT_HEX).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("TX_HASH is a 64-hex-char transaction hash", () => {
    expect(TX_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it("MUXED_ACCOUNT is a 69-char Strkey muxed account (M + 68 base-32 chars)", () => {
    expect(MUXED_ACCOUNT.length).toBe(69);
    expect(MUXED_ACCOUNT).toMatch(/^M[A-Z2-7]{68}$/);
  });
});

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

  it("detects a lowercase Stellar secret seed", () => {
    const result = findLeakedSecret(`key is ${STELLAR_SECRET.toLowerCase()}`);
    expect(result).not.toBeNull();
  });

  it("detects a 77-digit field-element scalar", () => {
    const result = findLeakedSecret(`nullifier: ${FIELD_ELEMENT_SCALAR}`);
    expect(result).not.toBeNull();
    expect(result).toBe(REDACT_PATTERNS[1]);
  });

  it("detects a 76-digit field-element scalar (below the old floor)", () => {
    const scalar = FIELD_ELEMENT_SCALAR.slice(1);
    expect(scalar.length).toBe(76);
    expect(findLeakedSecret(`nullifier: ${scalar}`)).not.toBeNull();
  });

  it("detects a hex field-element scalar", () => {
    expect(findLeakedSecret(`identitySecret=${FIELD_ELEMENT_HEX}`)).not.toBeNull();
  });

  it("detects a muxed account Strkey", () => {
    expect(findLeakedSecret(`muxed: ${MUXED_ACCOUNT}`)).not.toBeNull();
  });

  it("does not false-positive on a short decimal number", () => {
    expect(findLeakedSecret("circleId: 12345678")).toBeNull();
  });

  it("does not false-positive on a contract ID starting with C", () => {
    expect(
      findLeakedSecret("CB64IZIBBSPUY63UMIVACKWDKRFNH6WJ2EPAOLM7QR4ZI6IJOT4N2LCF"),
    ).toBeNull();
  });

  it("does not false-positive on a 64-hex-char transaction hash", () => {
    expect(findLeakedSecret(`tx: ${TX_HASH}`)).toBeNull();
  });

  it("does not false-positive on a sha256: artifact hash", () => {
    expect(findLeakedSecret("wasm: sha256:abc123")).toBeNull();
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

  it("redacts a Stellar secret seed injected into a runtime field", () => {
    // Simulate an accidental inclusion — e.g. lastError surfacing a secret.
    const poisoned: BundleInput = {
      ...CLEAN_INPUT,
      lastError: `Failed: key is ${STELLAR_SECRET}`,
    };
    const bundle = buildDebugBundle(poisoned);
    expect(bundle.lastError).not.toContain(STELLAR_SECRET);
    expect(bundle.lastError).toContain("[REDACTED]");
  });

  it("redacts a field-element scalar injected into a runtime field", () => {
    const poisoned: BundleInput = {
      ...CLEAN_INPUT,
      lastError: `identityNullifier=${FIELD_ELEMENT_SCALAR}`,
    };
    const bundle = buildDebugBundle(poisoned);
    expect(bundle.lastError).not.toContain(FIELD_ELEMENT_SCALAR);
    expect(bundle.lastError).toContain("[REDACTED]");
  });

  it("redacts a hex scalar injected into a runtime field", () => {
    const poisoned: BundleInput = {
      ...CLEAN_INPUT,
      lastError: `identitySecret=${FIELD_ELEMENT_HEX}`,
    };
    const bundle = buildDebugBundle(poisoned);
    expect(bundle.lastError).not.toContain(FIELD_ELEMENT_HEX);
    expect(bundle.lastError).toContain("[REDACTED]");
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

  it("includes recent SDK events in the markdown", () => {
    const bundle = buildDebugBundle(CLEAN_INPUT);
    const md = formatBundleAsMarkdown(bundle);
    expect(md).toContain("#### Recent SDK events");
    expect(md).toContain("rpc:retry");
  });
});
