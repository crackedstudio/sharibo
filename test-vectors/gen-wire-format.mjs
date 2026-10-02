// Regenerates test-vectors/wire-format.json from scratch.
// Run from the repo root:
//
//   node test-vectors/gen-wire-format.mjs > test-vectors/wire-format.json
//
// Requires Node.js 20+ (webcrypto.subtle). No external dependencies.
//
// This file encodes the encoding rules in docs/wire-format.md. If a test
// fails after a dependency bump, the implementations have diverged from the
// spec — do NOT edit the committed vectors to match; fix the divergence.

import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const FR_MODULUS =
  0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

// ── Helpers ──────────────────────────────────────────────────────────

function bytesToBigInt(bytes) {
  return BigInt(
    "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""),
  );
}

function g1Encode(xDecimal, yDecimal) {
  const x = BigInt(xDecimal);
  const y = BigInt(yDecimal);
  const xb = bigIntToBytes(x, 48);
  const yb = bigIntToBytes(y, 48);
  return Buffer.concat([xb, yb]).toString("hex");
}

function g2Encode(coords) {
  // coords = [[x_c0, x_c1], [y_c0, y_c1], [1, 0]]
  const x_c0 = BigInt(coords[0][0]);
  const x_c1 = BigInt(coords[0][1]);
  const y_c0 = BigInt(coords[1][0]);
  const y_c1 = BigInt(coords[1][1]);
  return Buffer.concat([
    bigIntToBytes(x_c1, 48),
    bigIntToBytes(x_c0, 48),
    bigIntToBytes(y_c1, 48),
    bigIntToBytes(y_c0, 48),
  ]).toString("hex");
}

function bigIntToBytes(value, length) {
  const hex = value.toString(16).padStart(length * 2, "0");
  return Buffer.from(hex, "hex");
}

// ── External nullifier known-answer tests ────────────────────────────

async function computeExternalNullifier(circleId, round) {
  const buf = new ArrayBuffer(12);
  const view = new DataView(buf);
  view.setBigUint64(0, circleId, false);
  view.setUint32(8, Number(round), false);
  const digest = await webcrypto.subtle.digest("SHA-256", buf);
  return bytesToBigInt(new Uint8Array(digest));
}

const externalNullifierVectors = [];
const testPairs = [
  [0n, 0n],
  [1n, 0n],
  [0n, 1n],
  [1n, 1n],
];

for (const [cid, rnd] of testPairs) {
  const preimageHex = Buffer.from(
    new ArrayBuffer(12),
  ).toString("hex");
  // Rebuild preimage hex properly
  const buf = new ArrayBuffer(12);
  const view = new DataView(buf);
  view.setBigUint64(0, cid, false);
  view.setUint32(8, Number(rnd), false);
  const preimageBuf = Buffer.from(buf);
  const digest = await webcrypto.subtle.digest("SHA-256", buf);
  const digestBytes = new Uint8Array(digest);
  const digestInt = bytesToBigInt(digestBytes);
  const reduced = digestInt % FR_MODULUS;

  const entry = {
    circleId: Number(cid),
    round: Number(rnd),
    preimageHex: preimageBuf.toString("hex"),
    sha256Hex: Buffer.from(digestBytes).toString("hex"),
    sha256Decimal: digestInt.toString(),
    result: reduced.toString(),
  };
  if (digestInt > FR_MODULUS) {
    entry._note = "sha256Decimal > r; result is the reduced value";
  }
  externalNullifierVectors.push(entry);
}

// ── G1/G2 encoding examples from verification_key.json ──────────────

const vkPath = join(repoRoot, "circuits", "verification_key.json");
const vk = JSON.parse(readFileSync(vkPath, "utf8"));

// vk_alpha_1: [x, y, 1] (affine projective, ignore z=1)
const alphaX = vk.vk_alpha_1[0];
const alphaY = vk.vk_alpha_1[1];

// IC[0]: [x, y, 1]
const ic0X = vk.IC[0][0];
const ic0Y = vk.IC[0][1];

// vk_beta_2: [[x_c0, x_c1], [y_c0, y_c1], [1, 0]]
const betaCoords = vk.vk_beta_2;

// ── Assemble the full vector file ────────────────────────────────────

const vectors = {
  _comment:
    "Cross-implementation wire-format test vectors. Validates the encoding rules in docs/wire-format.md. All three implementations (circuit, contract, client) must agree with these fixtures. Regenerate via: node test-vectors/gen-wire-format.mjs",
  frModulus: FR_MODULUS.toString(),

  publicSignalOrder: {
    _comment:
      "snarkjs emits circuit outputs first, then declared public inputs in source-order. The generated component main line is: component main { public [root, externalNullifier] } = Sharibo(4). So nullifierHash (output) is index 0, root (first declared public input) is index 1, externalNullifier (second) is index 2.",
    order: ["nullifierHash", "root", "externalNullifier"],
    indices: {
      nullifierHash: 0,
      root: 1,
      externalNullifier: 2,
    },
    contractVector: {
      _comment:
        "From the fullCircuitExample in poseidon.json — the public_inputs vector the contract must build as [nullifierHash, root, externalNullifier].",
      circleId: "1",
      round: "0",
      publicInputs: [
        "48059343990192610646459609261495992060469795976999050508299902288035919293419",
        "27229448404887127986721419334008530833780200287639716463067336202268364311337",
        "16562361372536717534118891681920966025734266982967870934512004608593732944167",
      ],
    },
  },

  externalNullifier: {
    _comment:
      "SHA-256 over big-endian u64(circle_id) || u32(round), reduced mod r. Both Rust (lib.rs) and TypeScript (identity.ts) must agree on byte order and modulus reduction. See docs/wire-format.md §2.",
    algorithm:
      "SHA-256( big_endian_u64(circle_id) || big_endian_u32(round) ) mod r",
    preimageBytes: 12,
    preimageLayout:
      "circle_id: bytes 0..7 (big-endian u64), round: bytes 8..11 (big-endian u32)",
    vectors: externalNullifierVectors,
  },

  g1Encoding: {
    _comment:
      "Uncompressed G1Affine: 48-byte big-endian X || 48-byte big-endian Y = 96 bytes total. No compression flag, no point-at-infinity sentinel. See docs/wire-format.md §3.",
    format: "be_bytes(X) || be_bytes(Y)",
    byteLength: 96,
    examples: [
      {
        _comment: "vk_alpha_1 from verification_key.json",
        label: "vk.alpha",
        decimalCoordinates: { x: alphaX, y: alphaY },
        hex: g1Encode(alphaX, alphaY),
      },
      {
        _comment: "IC[0] from verification_key.json",
        label: "vk.ic[0]",
        decimalCoordinates: { x: ic0X, y: ic0Y },
        hex: g1Encode(ic0X, ic0Y),
      },
    ],
  },

  g2Encoding: {
    _comment:
      "Uncompressed G2Affine: 48-byte be(X.c1) || 48-byte be(X.c0) || 48-byte be(Y.c1) || 48-byte be(Y.c0) = 192 bytes. Each Fq2 element has c1 first, c0 second. See docs/wire-format.md §3.",
    format: "be_bytes(X.c1) || be_bytes(X.c0) || be_bytes(Y.c1) || be_bytes(Y.c0)",
    byteLength: 192,
    fq2Layout: "X = c0 + c1*u, encoded as [c1, c0] (c1 first)",
    examples: [
      {
        _comment: "vk_beta_2 from verification_key.json",
        label: "vk.beta",
        decimalCoordinates: {
          x: { c0: betaCoords[0][0], c1: betaCoords[0][1] },
          y: { c0: betaCoords[1][0], c1: betaCoords[1][1] },
        },
        hex: g2Encode(betaCoords),
      },
    ],
  },

  vkIcLengthRule: {
    _comment:
      "vk.ic.len() must equal number_of_public_signals + 1. The current circuit has 3 public signals, so ic must have exactly 4 elements. verify_groth16 in lib.rs enforces this: if public_inputs.len() + 1 != vk.ic.len(), it returns false.",
    numberOfPublicSignals: vk.nPublic,
    requiredIcLength: vk.nPublic + 1,
    formula: "ic.len() == public_inputs.len() + 1",
    verificationKeyFilePath: "circuits/verification_key.json",
  },
};

console.log(JSON.stringify(vectors, null, 2));
