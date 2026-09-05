pragma circom 2.1.6;

// NOTE: this circuit is compiled with `--prime bls12381` (see
// scripts/compile.sh), not circom's default bn128. Stellar's Soroban host
// only exposes accelerated pairing operations for BLS12-381, not BN254 — a
// pure-Rust BN254 pairing check was measured (via Stellar's own
// `import_ark_bn254` example) at ~560M CPU instructions for a SINGLE
// pairing against a 100M budget, i.e. infeasible. So the whole pipeline
// targets BLS12-381 instead, using a third-party Poseidon parameterization
// for that field (circomlib's Poseidon constants are BN254-only) — see
// NOTES.md for the full reasoning and provenance.
include "poseidon-bls12381-circom/circuits/poseidon255.circom";

// Standard fixed-depth Merkle inclusion proof (the same shape used by
// Tornado Cash / Semaphore). At each level, pathIndices[i] selects whether
// the current node is the left (0) or right (1) child before hashing up
// with its sibling pathElements[i]. Reference implementations providing
// this exact template were not present in the environment this was built
// in, so it is written here from the well-known pattern rather than copied
// — see NOTES.md.
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels]; // must be boolean (0 = left, 1 = right)

    signal levelHashes[levels + 1];
    levelHashes[0] <== leaf;

    signal left[levels];
    signal right[levels];
    component hashers[levels];

    for (var i = 0; i < levels; i++) {
        // Booleanity constraint: pathIndices[i] ∈ {0, 1}.
        // R1CS (Rank-1 Constraint Systems) only allow *quadratic* constraints,
        // so a plain `if` statement is not expressible. This single quadratic
        // constraint enforces that the index is boolean: for any value p other
        // than 0 or 1, p*(1-p) ≠ 0, so the proof would not satisfy it.
        // Without it, a malicious prover could set p to an arbitrary field
        // element, making left[i] and right[i] arbitrary combinations of the
        // two sibling hashes — effectively forging any desired "hash input"
        // and breaking the Merkle proof. The test `non-boolean path index`
        // covers this scenario.
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // Linear mux: select (left, right) from (levelHashes[i], pathElements[i])
        // using pathIndices[i] without an if-statement.
        //
        // When pathIndices[i] == 0 (current node is LEFT child):
        //   left  = (pathElements[i] - levelHashes[i]) * 0 + levelHashes[i]  = levelHashes[i]
        //   right = (levelHashes[i] - pathElements[i]) * 0 + pathElements[i] = pathElements[i]
        //
        // When pathIndices[i] == 1 (current node is RIGHT child):
        //   left  = (pathElements[i] - levelHashes[i]) * 1 + levelHashes[i]  = pathElements[i]
        //   right = (levelHashes[i] - pathElements[i]) * 1 + pathElements[i] = levelHashes[i]
        //
        // Both assignments are degree-2 (quadratic) — exactly what R1CS allows.
        left[i]  <== (pathElements[i] - levelHashes[i]) * pathIndices[i] + levelHashes[i];
        right[i] <== (levelHashes[i] - pathElements[i]) * pathIndices[i] + pathElements[i];

        hashers[i] = Poseidon255(2);
        hashers[i].in[0] <== left[i];
        hashers[i].in[1] <== right[i];

        levelHashes[i + 1] <== hashers[i].out;
    }

    root === levelHashes[levels];
}

// Sharibo membership + round-nullifier circuit.
//
// Proves, without revealing which leaf, that the prover's identity
// commitment sits in the circle's Merkle tree, and emits a nullifier bound
// to (identityNullifier, externalNullifier) so the contract can block a
// second claim in the same round without learning who claimed.
template Sharibo(levels) {
    // private witness (never leaves the member's device)
    signal input identityNullifier;
    signal input identitySecret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // public inputs (checked in the contract)
    signal input root;              // circle's committed member set
    // = SHA-256(circleId, roundIndex) mod r, reduced into the contract by
    // the same rule (see NOTES.md — this is SHA-256, not Poseidon, by
    // design: it binds the proof to a round outside the circuit's
    // constraint system, where Soroban has a native accelerated SHA-256 but
    // no native Poseidon; Poseidon is kept for everything hashed *inside*
    // the circuit, where constraint-efficiency actually matters).
    signal input externalNullifier;
    // public input: recipient binding. Squared into `recipientSquare` so
    // it is committed to (and left otherwise unused) — standard Semaphore
    // signal-binding pattern.
    signal input recipientHash;

    // public output (recorded by the contract)
    signal output nullifierHash;    // Poseidon(identityNullifier, externalNullifier)

    // 1. leaf = Poseidon(identityNullifier, identitySecret)
    component commitmentHasher = Poseidon255(2);
    commitmentHasher.in[0] <== identityNullifier;
    commitmentHasher.in[1] <== identitySecret;

    // 2. Merkle-prove leaf hashes up to `root`
    component tree = MerkleTreeChecker(levels);
    tree.leaf <== commitmentHasher.out;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // 3. nullifierHash = Poseidon(identityNullifier, externalNullifier)
    component nullifierHasher = Poseidon255(2);
    nullifierHasher.in[0] <== identityNullifier;
    nullifierHasher.in[1] <== externalNullifier;
    nullifierHash <== nullifierHasher.out;

    // Bind recipientHash into the witness (unused otherwise). Squaring
    // ensures the input is actually committed to while keeping the
    // constraint simple and cheap.
    signal recipientSquare;
    recipientSquare <== recipientHash * recipientHash;
}

// NOTE: no `component main` here. This file is the template; the concrete
// tree depth comes from circuits/config.json (single source of truth).
// `scripts/gen-circuit.cjs` appends the `component main` line and writes
// the result to circuits/membership.circom (generated, gitignored) before
// every compile/test run. See "Changing the Merkle tree depth" in the repo
// README for the full runbook.
