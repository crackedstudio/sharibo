# Poseidon Cross-Implementation Fixtures

This directory contains `poseidon.json`, the cross-implementation test vectors shared by the client (`poseidon-bls12381` in `packages/client`) and the circuit (`poseidon-bls12381-circom` in `circuits`).

## What the fixtures pin

These fixtures pin the exact Poseidon hashing outputs (both single pairs and full Merkle tree/circuit examples), as well as wire-format invariants like the full public-signal vector, the `externalNullifier` derivation (`SHA256(circle_id, round) mod r`), and the `G1`/`G2` byte encodings.

## Which implementations they cross-check

They ensure that the TypeScript/JavaScript client implementation and the Circom circuit implementation remain byte-identical. If only one side fails after a dependency bump, the implementations have diverged.

## When to regenerate

You should regenerate these fixtures ONLY if you are intentionally modifying the wire format, adding new public signals, or changing the hashing logic across both implementations. Do NOT regenerate this file just to make a failing test pass after a dependency bump; if a test disagrees with these committed vectors, fix the divergence instead.

## How to regenerate and review

To regenerate the fixtures, run from the repository root:

```bash
npm run generate --workspace=test-vectors
```

After regenerating, review the diff to ensure no unexpected changes occurred:

```bash
git diff test-vectors/poseidon.json
```

If the output differs from the committed file when you didn't expect it to (e.g. you're just verifying), that is a real finding and indicates a bug or unexpected formatting change.
