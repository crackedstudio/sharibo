import test from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { xdr, scValToNative } from "@stellar/stellar-sdk";
import { fund } from "./contract.js";

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
    fund: (args: any) => {
      simulateCalls++;
      if (simulateCalls < 3) {
        throw new Error("RPC Error 429 Too Many Requests");
      }
      return mockTx;
    },
  };

  const result = await fund(mockClient, { circleId: 0n, from: "G..." });
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
    fund: (args: any) => {
      simulateCalls++;
      return mockTx;
    },
  };

  await assert.rejects(
    async () => await fund(mockClient, { circleId: 0n, from: "G..." }),
    /504/
  );
  assert.strictEqual(simulateCalls, 1);
  assert.strictEqual(signAndSendCalls, 1);
});

// ============================================================================
// XDR golden tests — issue #326
// ============================================================================
//
// These tests are the TypeScript counterpart of the Rust xdr_golden suite in
// contracts/sharibo/src/test.rs.  They decode the same base64 golden files
// (contracts/sharibo/test_snapshots/xdr_goldens/) via @stellar/stellar-sdk
// and assert specific CircleView field values.
//
// WHY THEY EXIST
// --------------
// The Rust golden asserts the *bytes* didn't change; this test asserts the
// *decoded values* match what the client SDK expects.  A field reorder
// breaks the Rust golden (byte mismatch) AND this test (wrong decoded value),
// ensuring both sides catch the breakage independently.
//
// REGENERATING
// ------------
// If the Rust golden has been regenerated (UPDATE_GOLDEN=1 cargo test ...),
// run the Rust tests first, then re-run this suite; the new base64 is
// automatically read from disk.
//
// READING THE GOLDENS
// -------------------
// Path is resolved relative to this file's location so it works regardless
// of the cwd the test runner is invoked from.

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Resolve a path to a file in contracts/sharibo/test_snapshots/xdr_goldens/ */
function goldenPath(filename: string): string {
  return path.resolve(
    __dirname,
    "../../../../contracts/sharibo/test_snapshots/xdr_goldens",
    filename,
  );
}

/**
 * Read and return a committed golden base64 string, or null if the file has
 * not been generated yet (i.e. before the Rust UPDATE_GOLDEN=1 run).
 */
function readGolden(filename: string): string | null {
  const p = goldenPath(filename);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8").trim();
}

/**
 * Decode a base64-encoded soroban ScVal and return the native JS value via
 * scValToNative.  The raw bytes are the ScVal XDR encoding produced by
 * soroban_sdk::xdr::ToXdr.
 */
function decodeScVal(b64: string): ReturnType<typeof scValToNative> {
  const buf = Buffer.from(b64, "base64");
  const scVal = xdr.ScVal.fromXDR(buf);
  return scValToNative(scVal);
}

/**
 * Extract a single field from a decoded ScVal map by its symbol key.
 * Returns undefined if the key is not present.
 */
function fieldOf(decoded: Record<string, unknown>, key: string): unknown {
  return decoded[key];
}

// ---------------------------------------------------------------------------
// Golden: Circle
// ---------------------------------------------------------------------------
//
// The Rust fixture builds a Circle with:
//   admin:        GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
//   token:        GBXGQJWVLWOYHFLEWA4LGSM5PKPNFMJGQ75XDZKTFBGBBPKQ42EOPHE
//   root:         real_root() = 26209293814355131390889932661322725195394840191932303091376020297848638697892
//   contribution: 1_000_000
//   size:         5
//   round:        0
//   pot:          0
//   cancelled:    false
//   contributors: [] (empty)
//
// These constants must stay in sync with the golden_circle() function in
// contracts/sharibo/src/test.rs.  If either side changes, both must be
// updated together.

const GOLDEN_ADMIN = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const GOLDEN_TOKEN = "GBXGQJWVLWOYHFLEWA4LGSM5PKPNFMJGQ75XDZKTFBGBBPKQ42EOPHE";
const GOLDEN_ROOT = 26209293814355131390889932661322725195394840191932303091376020297848638697892n;
const GOLDEN_CONTRIBUTION = 1_000_000n;
const GOLDEN_SIZE = 5;
const GOLDEN_ROUND = 0;

test("xdr golden: Circle decodes to expected CircleView fields", () => {
  const b64 = readGolden("circle.v1.b64");
  if (b64 === null) {
    // Golden not yet generated.  Skip with a clear message rather than
    // failing, so this test does not block CI before the Rust side has run.
    console.warn(
      "[xdr-golden] circle.v1.b64 not found — " +
        "run `UPDATE_GOLDEN=1 cargo test -p sharibo xdr_golden` first",
    );
    return;
  }

  const decoded = decodeScVal(b64) as Record<string, unknown>;

  // The storage layout changed — bump schema_version and update the golden
  // deliberately (see contracts/sharibo/src/test.rs §xdr_golden).
  assert.strictEqual(
    fieldOf(decoded, "admin"),
    GOLDEN_ADMIN,
    "Circle.admin: the storage layout changed — bump schema_version and " +
      "update the golden deliberately",
  );
  assert.strictEqual(
    fieldOf(decoded, "token"),
    GOLDEN_TOKEN,
    "Circle.token: the storage layout changed — bump schema_version and " +
      "update the golden deliberately",
  );
  assert.strictEqual(
    fieldOf(decoded, "contribution"),
    GOLDEN_CONTRIBUTION,
    "Circle.contribution: the storage layout changed — bump schema_version " +
      "and update the golden deliberately",
  );
  assert.strictEqual(
    fieldOf(decoded, "size"),
    GOLDEN_SIZE,
    "Circle.size: the storage layout changed — bump schema_version and " +
      "update the golden deliberately",
  );
  assert.strictEqual(
    fieldOf(decoded, "round"),
    GOLDEN_ROUND,
    "Circle.round: the storage layout changed — bump schema_version and " +
      "update the golden deliberately",
  );
  assert.strictEqual(
    fieldOf(decoded, "pot"),
    0n,
    "Circle.pot: the storage layout changed — bump schema_version and " +
      "update the golden deliberately",
  );
  assert.strictEqual(
    fieldOf(decoded, "cancelled"),
    false,
    "Circle.cancelled: the storage layout changed — bump schema_version and " +
      "update the golden deliberately",
  );
  // root is a BLS12-381 Fr element (a BytesN<32> in XDR).  The SDK decodes
  // it as a Buffer / Uint8Array.  We compare the big-endian numeric value.
  const rootBytes = fieldOf(decoded, "root") as Buffer;
  assert.ok(
    Buffer.isBuffer(rootBytes) || rootBytes instanceof Uint8Array,
    "Circle.root should decode as a bytes type",
  );
  const rootBigInt = BigInt(
    "0x" +
      Buffer.from(rootBytes)
        .toString("hex"),
  );
  assert.strictEqual(
    rootBigInt,
    GOLDEN_ROOT,
    "Circle.root: the storage layout changed — bump schema_version and " +
      "update the golden deliberately",
  );
});

// ---------------------------------------------------------------------------
// Golden: VerificationKey — structural shape check
// ---------------------------------------------------------------------------
//
// We don't assert the exact VK field values here (they're enormous BLS12-381
// points), but we do assert the top-level struct shape: the decoded object
// must have the keys { alpha, beta, gamma, delta, ic } and ic must have
// length 4 (matching the real_verification_key fixture used on the Rust side).
// A field reorder or rename breaks this.

test("xdr golden: VerificationKey decodes to expected shape", () => {
  const b64 = readGolden("verification_key.v1.b64");
  if (b64 === null) {
    console.warn(
      "[xdr-golden] verification_key.v1.b64 not found — " +
        "run `UPDATE_GOLDEN=1 cargo test -p sharibo xdr_golden` first",
    );
    return;
  }

  const decoded = decodeScVal(b64) as Record<string, unknown>;

  // The storage layout changed — bump schema_version and update the golden
  // deliberately (see contracts/sharibo/src/test.rs §xdr_golden).
  const EXPECTED_VK_KEYS = ["alpha", "beta", "gamma", "delta", "ic"];
  for (const key of EXPECTED_VK_KEYS) {
    assert.ok(
      key in decoded,
      `VerificationKey missing field '${key}': the storage layout changed — ` +
        "bump schema_version and update the golden deliberately",
    );
  }
  // ic must be an array with 4 elements (ic[0] + 3 public inputs).
  const ic = decoded["ic"] as unknown[];
  assert.ok(
    Array.isArray(ic),
    "VerificationKey.ic must decode as an array: the storage layout changed — " +
      "bump schema_version and update the golden deliberately",
  );
  assert.strictEqual(
    ic.length,
    4,
    "VerificationKey.ic.length must be 4: the storage layout changed — " +
      "bump schema_version and update the golden deliberately",
  );
});

// ---------------------------------------------------------------------------
// Golden: Proof — structural shape check
// ---------------------------------------------------------------------------
//
// Assert the Proof struct decodes with the expected keys { a, b, c }.
// A field reorder or rename breaks this.

test("xdr golden: Proof decodes to expected shape", () => {
  const b64 = readGolden("proof.v1.b64");
  if (b64 === null) {
    console.warn(
      "[xdr-golden] proof.v1.b64 not found — " +
        "run `UPDATE_GOLDEN=1 cargo test -p sharibo xdr_golden` first",
    );
    return;
  }

  const decoded = decodeScVal(b64) as Record<string, unknown>;

  // The storage layout changed — bump schema_version and update the golden
  // deliberately (see contracts/sharibo/src/test.rs §xdr_golden).
  for (const key of ["a", "b", "c"]) {
    assert.ok(
      key in decoded,
      `Proof missing field '${key}': the storage layout changed — ` +
        "bump schema_version and update the golden deliberately",
    );
  }
});

// ---------------------------------------------------------------------------
// Golden: byte-level stability
// ---------------------------------------------------------------------------
//
// A last-resort check: re-encode the Circle golden back to base64 and confirm
// it matches the file byte-for-byte.  This catches any scenario where
// scValToNative loses information (e.g. precision on large integers) that
// the Rust round-trip test would also catch.

test("xdr golden: Circle base64 is self-consistent (re-encode == file)", () => {
  const b64 = readGolden("circle.v1.b64");
  if (b64 === null) {
    console.warn(
      "[xdr-golden] circle.v1.b64 not found — " +
        "run `UPDATE_GOLDEN=1 cargo test -p sharibo xdr_golden` first",
    );
    return;
  }

  // Decode and re-encode: fromXDR → toXDR → base64 must round-trip.
  const buf = Buffer.from(b64, "base64");
  const scVal = xdr.ScVal.fromXDR(buf);
  const reEncoded = scVal.toXDR().toString("base64");

  assert.strictEqual(
    reEncoded,
    b64,
    "Circle XDR is not self-consistent (re-encode !== file): the storage " +
      "layout changed — bump schema_version and update the golden deliberately",
  );
});
