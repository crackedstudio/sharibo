const fs = require("fs");
const path = require("path");
const { expect } = require("chai");
const wasm_tester = require("circom_tester").wasm;
const snarkjs = require("snarkjs");
const {
  generateIdentity,
  computeExternalNullifier,
  computeNullifierHash,
  computeRecipientHash,
  FR_MODULUS,
} = require("../../packages/client/src/identity.ts");
const { MerkleTree } = require("../../packages/client/src/tree.ts");
const {
  referenceProof,
} = require("../../packages/client/src/tree.reference.ts");

// Single source of truth for the tree depth is circuits/config.json (see
// "Changing the Merkle tree depth" in the repo README) — read it here
// instead of hardcoding the level count a second time.
const { generate: generateCircuit } = require("../scripts/gen-circuit.cjs");
const CIRCUITS_CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8"),
);
// Allow overriding the configured levels via the `LEVELS` environment
// variable (useful for CI or local benchmarking runs):
const LEVELS = Number(process.env.LEVELS || CIRCUITS_CONFIG.levels);

// Committed expected constraint count per tree depth (issue #272) — see
// circuits/constraints.json. Keyed by depth so it survives the
// configurable-depth work instead of pinning a single global number.
const CONSTRAINTS_PATH = path.join(__dirname, "..", "constraints.json");
const COMMITTED_CONSTRAINTS = JSON.parse(fs.readFileSync(CONSTRAINTS_PATH, "utf8"));

const VECTORS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "test-vectors", "poseidon.json"), "utf8"),
);

describe("Sharibo membership circuit (BLS12-381)", function () {
  this.timeout(120000);

  let circuit;
  let identities;
  let tree;

  before(async () => {
    // Regenerate membership.circom from the template + config.json so the
    // test always exercises the circuit matching the current tree depth.
    // Pass the resolved LEVELS through so the generated circuit matches
    // what the test will exercise (env var takes precedence).
    generateCircuit(LEVELS);

    circuit = await wasm_tester(path.join(__dirname, "..", "membership.circom"), {
      include: path.join(__dirname, "..", "..", "node_modules"),
      prime: "bls12381",
    });

    identities = Array.from({ length: 5 }, () => generateIdentity());
    tree = MerkleTree.create(
      LEVELS,
      identities.map((id) => id.commitment),
    );
  });

  // The constraint count drives browser proving time, .zkey size, and
  // on-chain verification cost (see circuits/README.md "Constraint count").
  // wasm_tester's compile step already writes a .r1cs alongside the .wasm
  // (circom_tester always compiles with --r1cs), so this reads that same
  // artifact rather than recompiling. Keyed by LEVELS in constraints.json so
  // a circuit edit or a Poseidon dependency bump that silently changes the
  // count fails here instead of shipping unnoticed (issue #272).
  it("compiled constraint count matches the committed circuits/constraints.json", async () => {
    const r1csPath = path.join(circuit.dir, circuit.baseName + ".r1cs");
    const info = await snarkjs.r1cs.info(r1csPath);
    // readR1cs() builds a curve object backed by worker_threads for field
    // arithmetic; without terminating it, those workers keep the process
    // alive and mocha never exits even though all tests already passed.
    await info.curve.terminate();
    const actual = info.nConstraints;
    const depthKey = String(LEVELS);
    const committed = COMMITTED_CONSTRAINTS[depthKey];

    if (committed === undefined) {
      throw new Error(
        `circuits/constraints.json has no committed constraint count for tree depth ${depthKey}. ` +
          `This build's actual count is ${actual}. If that's expected, add ` +
          `"${depthKey}": ${actual} to circuits/constraints.json.`,
      );
    }

    expect(
      actual,
      `Compiled constraint count for depth ${depthKey} is ${actual}, but circuits/constraints.json ` +
        `commits to ${committed}. If this change is intentional (circuit edit, Poseidon package bump, ` +
        `etc.), update "${depthKey}": ${committed} to "${depthKey}": ${actual} in circuits/constraints.json ` +
        `— and, per the README's "Keep in sync" note, the "Current count" line in circuits/README.md and ` +
        `the "1,452 constraints" search string in app/src/App.tsx.`,
    ).to.equal(committed);
  });

  async function buildInput(memberIndex, circleId, round) {
    const identity = identities[memberIndex];
    const merkleProof = tree.proof(memberIndex);
    const externalNullifier = await computeExternalNullifier(BigInt(circleId), BigInt(round));
    // recipientHash is unused inside the circuit (squared only), so supply
    // a deterministic placeholder value here.
    const recipientHash = "0";
    return {
      identityNullifier: identity.identityNullifier.toString(),
      identitySecret: identity.identitySecret.toString(),
      pathElements: merkleProof.pathElements.map((e) => e.toString()),
      pathIndices: merkleProof.pathIndices,
      root: merkleProof.root.toString(),
      externalNullifier: externalNullifier.toString(),
      recipientHash: recipientHash,
    };
  }

  async function expectThrows(fn) {
    let threw = false;
    try {
      await fn();
    } catch (e) {
      threw = true;
    }
    expect(threw, "expected the operation to throw").to.equal(true);
  }

  it("accepts a genuine member and outputs the correct nullifierHash", async () => {
    const input = await buildInput(2, 1, 0);
    const witness = await circuit.calculateWitness(input, true);
    await circuit.checkConstraints(witness);

    const expected = computeNullifierHash(
      identities[2].identityNullifier,
      BigInt(input.externalNullifier),
    );
    await circuit.assertOut(witness, { nullifierHash: expected.toString() });
  });

  it("rejects a wrong root", async () => {
    const input = await buildInput(2, 1, 0);
    input.root = (BigInt(input.root) + 1n).toString();
    await expectThrows(() => circuit.calculateWitness(input, true));
  });

  it("rejects a non-member (tampered Merkle path)", async () => {
    const input = await buildInput(2, 1, 0);
    input.pathElements[0] = (BigInt(input.pathElements[0]) + 1n).toString();
    await expectThrows(() => circuit.calculateWitness(input, true));
  });

  it("nullifierHash is deterministic per identity+round and changes across rounds", async () => {
    await circuit.loadSymbols();
    const varIdx = circuit.symbols["main.nullifierHash"].varIdx;

    const inputA = await buildInput(3, 7, 0);
    const inputB = await buildInput(3, 7, 0);
    const inputNextRound = await buildInput(3, 7, 1);

    const witnessA = await circuit.calculateWitness(inputA, true);
    const witnessB = await circuit.calculateWitness(inputB, true);
    const witnessNextRound = await circuit.calculateWitness(inputNextRound, true);

    expect(witnessA[varIdx].toString()).to.equal(witnessB[varIdx].toString());
    expect(witnessA[varIdx].toString()).to.not.equal(witnessNextRound[varIdx].toString());
  });

  // Issue #268 — property not covered by the determinism/round-trip test
  // above: two *different* identities must not collide even when they share
  // the same externalNullifier (same circle + round). This is what lets the
  // contract tell distinct members apart on one shared round-gate; a
  // collision here would let two members reuse a single nullifier.
  it("different identities with the same externalNullifier produce different nullifierHash", async () => {
    await circuit.loadSymbols();
    const varIdx = circuit.symbols["main.nullifierHash"].varIdx;

    const inputA = await buildInput(2, 9, 1);
    const inputB = await buildInput(3, 9, 1);

    const witnessA = await circuit.calculateWitness(inputA, true);
    const witnessB = await circuit.calculateWitness(inputB, true);

    expect(witnessA[varIdx].toString()).to.not.equal(witnessB[varIdx].toString());
  });

  it("rejects a non-boolean pathIndices entry", async () => {
    const input = await buildInput(2, 1, 0);
    input.pathIndices[0] = 2;
    await expectThrows(() => circuit.calculateWitness(input, true));
  });

  // --- recipientHash binding tests (issue #266) ---

  it("accepts a genuine member with a valid recipientHash", async () => {
    const input = await buildInput(2, 1, 0);
    const witness = await circuit.calculateWitness(input, true);
    await circuit.checkConstraints(witness);

    const expected = computeNullifierHash(
      identities[2].identityNullifier,
      BigInt(input.externalNullifier),
    );
    await circuit.assertOut(witness, { nullifierHash: expected.toString() });
  });

  it("rejects a proof when recipientHash is swapped to a different value", async () => {
    const input = await buildInput(2, 1, 0);
    // Swap to a different recipientHash
    const differentRecipientHash = poseidon(333n, 444n);
    input.recipientHash = differentRecipientHash.toString();
    await expectThrows(() => circuit.calculateWitness(input, true));
  });

  it("public signals are pinned: [nullifierHash, root, externalNullifier, recipientHash]", async () => {
    const input = await buildInput(1, 4, 2);
    const witness = await circuit.calculateWitness(input, true);
    await circuit.checkConstraints(witness);

    // witness[0] is always the constant wire (1); the next four slots are
    // the public signals in the exact order snarkjs would emit them.
    const publicSignals = [
      witness[1].toString(),
      witness[2].toString(),
      witness[3].toString(),
      witness[4].toString(),
    ];

    const expectedNullifierHash = computeNullifierHash(
      identities[1].identityNullifier,
      BigInt(input.externalNullifier),
    );

    expect(publicSignals[0]).to.equal(expectedNullifierHash.toString());
    expect(publicSignals[1]).to.equal(input.root);
    expect(publicSignals[2]).to.equal(input.externalNullifier);
    expect(publicSignals[3]).to.equal(input.recipientHash);
  });

  // Cross-implementation fixture shared with
  // packages/client/src/poseidon-vectors.test.ts (see
  // test-vectors/generate.mjs). If only ONE side fails after a dependency
  // bump, the client and circuit Poseidon implementations have diverged -
  // do NOT edit the vectors to match, fix the divergence instead.
  it("reproduces the committed cross-implementation test vector (issue #67)", async () => {
    const { input, expectedPublicSignals } = VECTORS.fullCircuitExample;
    const witness = await circuit.calculateWitness(input, true);
    await circuit.checkConstraints(witness);
    await circuit.assertOut(witness, { nullifierHash: expectedPublicSignals.nullifierHash });
  });

  // Public signal order is the trickiest invariant in the repo: snarkjs
  // emits [nullifierHash, root, externalNullifier] - circuit output first,
  // then the public inputs in the order they're declared in the template
  // (see prove.ts). This pins both the VALUE and the POSITION: swapping the
  // `signal input root` / `signal input externalNullifier` declarations in
  // membership.circom would make this test fail (issue #69).
  it("public signals are pinned by position: [nullifierHash, root, externalNullifier, recipientHash]", async () => {
    const input = await buildInput(1, 4, 2);
    const witness = await circuit.calculateWitness(input, true);
    await circuit.checkConstraints(witness);
    // witness[0] is always the constant wire (1); the next four slots are
    // the public signals in the exact order snarkjs would emit them.
    const publicSignals = [
      witness[1].toString(),
      witness[2].toString(),
      witness[3].toString(),
      witness[4].toString(),
    ];

    const expectedNullifierHash = computeNullifierHash(
      identities[1].identityNullifier,
      BigInt(input.externalNullifier),
    );

    expect(publicSignals[0]).to.equal(expectedNullifierHash.toString());
    expect(publicSignals[1]).to.equal(input.root);
    expect(publicSignals[2]).to.equal(input.externalNullifier);
    expect(publicSignals[3]).to.equal(input.recipientHash);
  });

  // externalNullifier boundary values (issue #70). In practice it's always
  // `SHA256(...) mod r` (< r), but the circuit takes it as a raw,
  // unconstrained public input - nothing in the circuit itself enforces a
  // range on it.
  it("accepts externalNullifier = 0 (valid extreme)", async () => {
    const input = await buildInput(0, 11, 0);
    input.externalNullifier = "0";
    const witness = await circuit.calculateWitness(input, true);
    await circuit.checkConstraints(witness);
    const expected = computeNullifierHash(identities[0].identityNullifier, 0n);
    await circuit.assertOut(witness, { nullifierHash: expected.toString() });
  });

  it("accepts externalNullifier = r - 1 (valid extreme)", async () => {
    const input = await buildInput(0, 11, 0);
    const maxExternalNullifier = FR_MODULUS - 1n;
    input.externalNullifier = maxExternalNullifier.toString();
    const witness = await circuit.calculateWitness(input, true);
    await circuit.checkConstraints(witness);
    const expected = computeNullifierHash(identities[0].identityNullifier, maxExternalNullifier);
    await circuit.assertOut(witness, { nullifierHash: expected.toString() });
  });

  it("documents that externalNullifier binding is enforced by the verifier, not the circuit", async () => {
    // The circuit happily computes a witness for ANY externalNullifier
    // value (0 and r-1 above both satisfy all constraints) - it does not
    // itself bind the proof to one specific externalNullifier. What
    // actually prevents a prover from claiming a different
    // externalNullifier than the one they proved against is the verifier
    // comparing the proof's public signals (which include
    // externalNullifier verbatim, and nullifierHash which is a function of
    // it) to the externalNullifier value the verifier independently
    // expects for this round. A mismatched externalNullifier yields a
    // different, non-matching nullifierHash:
    const input = await buildInput(0, 13, 0);
    const witness = await circuit.calculateWitness(input, true);
    await circuit.checkConstraints(witness);

    const mismatchedExternalNullifier = (BigInt(input.externalNullifier) + 1n) % FR_MODULUS;
    const actualNullifierHash = computeNullifierHash(
      identities[0].identityNullifier,
      BigInt(input.externalNullifier),
    );
    const nullifierHashForMismatch = computeNullifierHash(
      identities[0].identityNullifier,
      mismatchedExternalNullifier,
    );

    expect(actualNullifierHash.toString()).to.not.equal(nullifierHashForMismatch.toString());
    await circuit.assertOut(witness, { nullifierHash: actualNullifierHash.toString() });
  });

  // ── Differential fuzz: SDK tree vs circuit ──────────────────────────────
  //
  // This is the end-to-end convention check that no pure-TS test can catch:
  // a proof generated by the *reference* Merkle implementation (tree.reference.ts)
  // is fed directly into circuit.calculateWitness.  If pathIndices, sibling
  // ordering, or the (left, right) convention in tree.reference.ts ever
  // disagrees with MerkleTreeChecker, this test fails with a constraint
  // violation — not just a value mismatch inside JS.
  //
  // We run FUZZ_CASES distinct (identity, leafIndex) pairs so that the
  // circuit exercises a spread of left/right branching decisions.  Each
  // case uses the same shared tree so the witness-generation cost stays
  // linear in FUZZ_CASES, not quadratic.
  it("reference SDK proof is accepted by the circuit for multiple random members (fuzz)", async () => {
    // Number of distinct members to prove for.  Enough to cover all
    // pathIndices[0] combinations (left vs right at the leaf level) and a
    // variety of higher-level branch combinations.  Kept small so the
    // circuit test suite completes in the existing 120 s budget.
    const FUZZ_CASES = 5; // all 5 real members in the shared `identities` array

    // Use the identities/tree built in before() — a 5-member tree at depth
    // LEVELS.  The reference proof is built here independently of the
    // production MerkleTree, so it will diverge from the circuit if and
    // only if tree.reference.ts has the wrong convention.
    for (let memberIndex = 0; memberIndex < FUZZ_CASES; memberIndex++) {
      const identity = identities[memberIndex];
      const externalNullifier = await computeExternalNullifier(BigInt(42 + memberIndex), BigInt(0));

      // Build the proof using the *reference* implementation, not the
      // production MerkleTree.  This is the point of the test.
      const refProof = referenceProof(
        LEVELS,
        identities.map((id) => id.commitment),
        memberIndex,
      );

      const input = {
        identityNullifier: identity.identityNullifier.toString(),
        identitySecret: identity.identitySecret.toString(),
        pathElements: refProof.pathElements.map((e) => e.toString()),
        pathIndices: refProof.pathIndices,
        root: refProof.root.toString(),
        externalNullifier: externalNullifier.toString(),
      };

      // calculateWitness throws if any constraint is violated — a wrong
      // sibling or direction bit immediately fails the Merkle root check.
      const witness = await circuit.calculateWitness(input, true);
      await circuit.checkConstraints(witness);

      // Also assert the nullifierHash output so a wrong externalNullifier
      // binding would be caught here rather than silently passing.
      const expectedNullifierHash = computeNullifierHash(
        identity.identityNullifier,
        externalNullifier,
      );
      await circuit.assertOut(witness, { nullifierHash: expectedNullifierHash.toString() });
    }
  });
});
