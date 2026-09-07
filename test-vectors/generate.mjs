// Regenerates test-vectors/poseidon.json from the CLIENT implementation
// (poseidon-bls12381) — this is the single source of truth for these
// vectors. Run from the repo root:
//
//   node --experimental-vm-modules test-vectors/generate.mjs > test-vectors/poseidon.json
//
// (requires `poseidon-bls12381` installed; run `npm install` in
// packages/client first, or `npm install poseidon-bls12381` locally).
//
// Do NOT regenerate this file just to make a failing test pass — if the
// circuit test (circuits/test/membership.test.js) or the client test
// (packages/client/src/*.test.ts) disagrees with these committed vectors
// after a dependency bump, the two Poseidon implementations have diverged.
// That is the exact bug this fixture exists to catch.
import { poseidon2 } from "poseidon-bls12381";
import { webcrypto } from "node:crypto";

const FR_MODULUS = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

function poseidon(a, b) {
  return poseidon2([a, b]);
}

// Deterministic pseudo-random field elements for reproducible fixtures
// (NOT secure randomness — fine for a committed test vector file).
function detField(seed) {
  let x = BigInt(seed) * 6364136223846793005n + 1442695040888963407n;
  x = x ^ (x >> 33n);
  x = (x * 0xff51afd7ed558ccdn) & ((1n << 256n) - 1n);
  x = x ^ (x >> 33n);
  return x % FR_MODULUS;
}

// ── 1. Raw poseidon2 pair vectors ───────────────────────────────────────────
const pairVectors = [];
for (let i = 0; i < 10; i++) {
  const a = detField(i * 2 + 1);
  const b = detField(i * 2 + 2);
  const out = poseidon(a, b);
  pairVectors.push({ a: a.toString(), b: b.toString(), poseidon2: out.toString() });
}

// ── 2. Commitment / nullifierHash examples ──────────────────────────────────
const identityNullifier = detField(101);
const identitySecret = detField(102);
const commitment = poseidon(identityNullifier, identitySecret);

const externalNullifierExample = detField(103) % FR_MODULUS;
const nullifierHash = poseidon(identityNullifier, externalNullifierExample);

// ── 3. Full circuit input -> expected public signals ────────────────────────
const LEVELS = 4;
const CAPACITY = 2 ** LEVELS;

const leaves = [];
for (let i = 0; i < 5; i++) {
  const idNullifier = detField(200 + i * 2);
  const idSecret = detField(200 + i * 2 + 1);
  leaves.push({
    identityNullifier: idNullifier,
    identitySecret: idSecret,
    commitment: poseidon(idNullifier, idSecret),
  });
}
const padded = leaves.map((l) => l.commitment);
while (padded.length < CAPACITY) padded.push(0n);

const layers = [padded];
let current = padded;
for (let level = 0; level < LEVELS; level++) {
  const next = [];
  for (let i = 0; i < current.length; i += 2) {
    next.push(poseidon(current[i], current[i + 1]));
  }
  layers.push(next);
  current = next;
}
const root = layers[LEVELS][0];

function merkleProof(leafIndex) {
  const pathElements = [];
  const pathIndices = [];
  let index = leafIndex;
  for (let level = 0; level < LEVELS; level++) {
    const layer = layers[level];
    const isRight = index % 2 === 1;
    const siblingIndex = isRight ? index - 1 : index + 1;
    pathElements.push(layer[siblingIndex]);
    pathIndices.push(isRight ? 1 : 0);
    index = Math.floor(index / 2);
  }
  return { pathElements, pathIndices };
}

function bytesToBigInt(bytes) {
  return BigInt("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
}

async function computeExternalNullifier(circleId, round) {
  const buf = new ArrayBuffer(12);
  const view = new DataView(buf);
  view.setBigUint64(0, circleId, false);
  view.setUint32(8, Number(round), false);
  const digest = await webcrypto.subtle.digest("SHA-256", buf);
  return bytesToBigInt(new Uint8Array(digest)) % FR_MODULUS;
}

const memberIndex = 2;
const circleId = 1n;
const round = 0n;
const externalNullifier = await computeExternalNullifier(circleId, round);
const { pathElements, pathIndices } = merkleProof(memberIndex);
const member = leaves[memberIndex];
const circuitNullifierHash = poseidon(member.identityNullifier, externalNullifier);

// Deterministic recipientHash for the cross-implementation fixture.
const recipientHash = poseidon(111n, 222n);

const fullCircuitExample = {
  input: {
    identityNullifier: member.identityNullifier.toString(),
    identitySecret: member.identitySecret.toString(),
    pathElements: pathElements.map((e) => e.toString()),
    pathIndices,
    root: root.toString(),
    externalNullifier: externalNullifier.toString(),
    recipientHash: recipientHash.toString(),
  },
  circleId: circleId.toString(),
  round: round.toString(),
  memberIndex,
  expectedPublicSignals: {
    nullifierHash: circuitNullifierHash.toString(),
    root: root.toString(),
    externalNullifier: externalNullifier.toString(),
  },
};

const vectors = {
  _comment:
    "Committed cross-implementation test vectors shared by the client (poseidon-bls12381) and the circuit (poseidon-bls12381-circom). If only ONE side fails after a dependency bump, the implementations have diverged - do NOT edit the vectors to make it pass; fix the divergence instead.",
  frModulus: FR_MODULUS.toString(),
  poseidon2PairVectors: pairVectors,
  commitmentExample: {
    identityNullifier: identityNullifier.toString(),
    identitySecret: identitySecret.toString(),
    commitment: commitment.toString(),
  },
  nullifierHashExample: {
    identityNullifier: identityNullifier.toString(),
    externalNullifier: externalNullifierExample.toString(),
    nullifierHash: nullifierHash.toString(),
  },
  fullCircuitExample,
};

console.log(JSON.stringify(vectors, null, 2));
