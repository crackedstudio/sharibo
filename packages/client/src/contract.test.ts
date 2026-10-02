import { test } from "vitest";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { xdr, scValToNative } from "@stellar/stellar-sdk";
import { fund, populateTxResult } from "./contract.js";
import { DEFAULT_RETRY_POLICY } from "./retry.js";

/** Committed fixture: shape of a real `signAndSend()` success payload from the SDK. */
const SIGN_AND_SEND_FIXTURE = {
  result: undefined,
  sendTransactionResponse: { hash: "abc123" },
  getTransactionResponse: { ledger: 1_234_567, feeCharged: "100" },
} as const;

test("transient simulate-phase failure recovers", async () => {
  let simulateCalls = 0;
  let signAndSendCalls = 0;
  const mockTx = {
    signAndSend: async () => {
      signAndSendCalls++;
      return {
        result: undefined,
        sendTransactionResponse: { hash: "0xabc" },
      };
    },
  };

  const mockClient = {
    fund: () => {
      simulateCalls++;
      if (simulateCalls < 3) {
        throw new Error("RPC Error 429 Too Many Requests");
      }
      return mockTx;
    },
  };

  const policy = { ...DEFAULT_RETRY_POLICY, sleep: async () => {} };

  const result = await fund(mockClient, { circleId: 0n, from: "G..." }, policy);
  assert.strictEqual(simulateCalls, 3);
  assert.strictEqual(signAndSendCalls, 1);
  assert.strictEqual(result.hash, "0xabc");
});

test("post-submit failure surfaces immediately without a second submission", async () => {
  let simulateCalls = 0;
  let signAndSendCalls = 0;
  const mockTx = {
    signAndSend: async () => {
      signAndSendCalls++;
      throw new Error("RPC Error 504 Gateway Timeout during polling");
    },
  };

  const mockClient = {
    fund: () => {
      simulateCalls++;
      return mockTx;
    },
  };

  await assert.rejects(
    async () =>
      await fund(
        mockClient,
        { circleId: 0n, from: "G..." },
        {
          ...DEFAULT_RETRY_POLICY,
          sleep: async () => {},
        },
      ),
    /504/,
  );
  assert.strictEqual(simulateCalls, 1);
  assert.strictEqual(signAndSendCalls, 1);
});

test("fund() maps signAndSend fixture to TxResult (hash, ledger, feeCharged bigint)", async () => {
  const mockTx = {
    signAndSend: async () => ({ ...SIGN_AND_SEND_FIXTURE }),
  };
  const mockClient = {
    fund: () => mockTx,
    networkPassphrase: "Test SDF Network ; September 2015",
  };

  const result = await fund(mockClient, { circleId: 0n, from: "G..." });

  assert.strictEqual(result.hash, "abc123");
  assert.strictEqual(result.ledger, 1_234_567);
  assert.strictEqual(result.feeCharged, 100n);
  assert.strictEqual(result.explorerUrl, "https://stellar.expert/explorer/testnet/tx/abc123");
});

test("populateTxResult throws when hash is missing or empty", () => {
  assert.throws(
    () =>
      populateTxResult(undefined, {
        result: undefined,
        sendTransactionResponse: {},
      }),
    (err: Error) => err.message === "hash",
  );
  assert.throws(
    () =>
      populateTxResult(undefined, {
        result: undefined,
        sendTransactionResponse: { hash: "" },
      }),
    (err: Error) => err.message === "hash",
  );
});

test("fund() throws when signAndSend returns no hash", async () => {
  const mockClient = {
    fund: () => ({
      signAndSend: async () => ({
        result: undefined,
        sendTransactionResponse: {},
      }),
    }),
  };

  await assert.rejects(
    () => fund(mockClient, { circleId: 0n, from: "G..." }),
    (err: Error) => err.message === "hash",
  );
});

// ---------------------------------------------------------------------------
// XDR goldens — issue #566
// ---------------------------------------------------------------------------

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_VERSION = 2;

function goldenPath(filename: string): string {
  const underTestVectors = path.resolve(__dirname, "../../../../test-vectors/xdr", filename);
  if (fs.existsSync(underTestVectors)) return underTestVectors;
  return path.resolve(
    __dirname,
    "../../../../contracts/sharibo/test_snapshots/xdr_goldens",
    filename,
  );
}

function readGolden(filename: string): string | null {
  const p = goldenPath(filename);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8").trim();
}

function decodeScVal(b64: string): ReturnType<typeof scValToNative> {
  const buf = Buffer.from(b64, "base64");
  return scValToNative(xdr.ScVal.fromXDR(buf));
}

test("xdr golden: Circle decodes with schema_version and expected scalars", () => {
  const name = `circle.v${SCHEMA_VERSION}.b64`;
  const b64 = readGolden(name);
  if (b64 === null) {
    console.warn(`[xdr-golden] ${name} missing — run just xdr-goldens first`);
    return;
  }
  const decoded = decodeScVal(b64) as Record<string, unknown>;
  assert.strictEqual(
    decoded.schema_version,
    SCHEMA_VERSION,
    "layout changed without schema_version bump",
  );
  assert.strictEqual(decoded.contribution, 1_000_000n);
  assert.strictEqual(decoded.size, 5);
  assert.strictEqual(decoded.round, 0);
  assert.strictEqual(decoded.pot, 0n);
  assert.strictEqual(decoded.cancelled, false);
  assert.strictEqual(decoded.fee_bps, 0);
});

test("xdr golden: VerificationKey / Proof decode to expected shape", () => {
  for (const [stem, keys, icLen] of [
    ["verification_key", ["alpha", "beta", "gamma", "delta", "ic"], 5],
    ["proof", ["a", "b", "c"], undefined],
  ] as const) {
    const name = `${stem}.v${SCHEMA_VERSION}.b64`;
    const b64 = readGolden(name);
    if (b64 === null) {
      console.warn(`[xdr-golden] ${name} missing — run just xdr-goldens first`);
      return;
    }
    const decoded = decodeScVal(b64) as Record<string, unknown>;
    for (const key of keys) {
      assert.ok(key in decoded, `${stem} missing field '${key}'`);
    }
    if (icLen !== undefined) {
      const ic = decoded.ic as unknown[];
      assert.ok(Array.isArray(ic));
      assert.strictEqual(ic.length, icLen);
    }
  }
});

test("xdr golden: SDK encodeG1/encodeG2 reproduce VK alpha/beta limb bytes", async () => {
  const { encodeG1, encodeG2 } = await import("./prove.js");
  const vkPath = path.resolve(__dirname, "../../../../circuits/verification_key.json");
  if (!fs.existsSync(vkPath)) return;
  const vk = JSON.parse(fs.readFileSync(vkPath, "utf8")) as {
    vk_alpha_1: string[];
    vk_beta_2: string[][];
  };
  const alpha = encodeG1(vk.vk_alpha_1.slice(0, 2));
  const beta = encodeG2(vk.vk_beta_2.slice(0, 2) as string[][]);
  assert.strictEqual(alpha.length, 96);
  assert.strictEqual(beta.length, 192);
  // Non-trivial: not all zeros (guards coordinate-ordering bugs).
  assert.ok(alpha.some((b) => b !== 0));
  assert.ok(beta.some((b) => b !== 0));

  // Cross-check against the committed golden: alpha's uncompressed bytes must
  // appear inside the VerificationKey XDR payload.
  const name = `verification_key.v${SCHEMA_VERSION}.b64`;
  const b64 = readGolden(name);
  if (b64 === null) {
    console.warn(`[xdr-golden] ${name} missing — run just xdr-goldens first`);
    return;
  }
  const raw = Buffer.from(b64, "base64");
  assert.ok(
    raw.includes(Buffer.from(alpha)),
    "encodeG1(vk_alpha_1) must appear in the VerificationKey XDR golden",
  );
  assert.ok(
    raw.includes(Buffer.from(beta)),
    "encodeG2(vk_beta_2) must appear in the VerificationKey XDR golden",
  );
});

test("xdr golden: Circle base64 round-trips through stellar-sdk", () => {
  const name = `circle.v${SCHEMA_VERSION}.b64`;
  const b64 = readGolden(name);
  if (b64 === null) {
    console.warn(`[xdr-golden] ${name} missing — run just xdr-goldens first`);
    return;
  }
  const scVal = xdr.ScVal.fromXDR(Buffer.from(b64, "base64"));
  assert.strictEqual(scVal.toXDR().toString("base64"), b64);
});
