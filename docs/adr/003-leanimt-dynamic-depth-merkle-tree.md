# ADR 003: Evaluate LeanIMT (dynamic-depth Merkle tree) to replace the fixed-depth tree

- **Status:** Rejected
- **Date:** 2026-08-31
- **Issue:** [#277](https://github.com/crackedstudio/sharibo/issues/277)

## Context

Sharibo's current Merkle tree (`packages/client/src/tree.ts`) is fixed-depth and padded
with `ZERO_VALUE = 0n` for unused leaves. The depth is compiled directly into the circuit
(`circuits/membership.template.circom`) via `config.json` and is currently set to 4
(16-leaf capacity). A 5-member circle uses 5 of those 16 leaves; the other 11 are
zero-padding.

The concern is twofold:

1. **Proving-time waste** — at depth 4 the circuit runs 4 Poseidon hashes regardless of
   actual membership, so a 2-member circle pays the same proving cost as a 16-member one.
2. **Scalability ceiling** — growing beyond 16 members requires recompiling the circuit
   and redoing the trusted setup, which is a heavyweight operation.

Semaphore v4 addressed the equivalent problem by switching from a fixed-depth
`MerkleTreeChecker` to a `BinaryMerkleRoot(MAX_DEPTH)` template that accepts
`merkleProofLength` as a private input and accumulates partial roots conditionally, giving
the appearance of a dynamic depth.

This ADR asks: does that approach yield a real proving-time saving for Sharibo's 5-member
circles, and should we adopt it?

## What LeanIMT actually does inside a Groth16 circuit

The key insight is in `BinaryMerkleRoot`'s circom source
([zk-kit.circom](https://github.com/privacy-scaling-explorations/zk-kit.circom/blob/main/packages/binary-merkle-root/src/binary-merkle-root.circom)):

```circom
template BinaryMerkleRoot(MAX_DEPTH) {
    signal input leaf, depth, index, siblings[MAX_DEPTH];
    signal output out;

    signal nodes[MAX_DEPTH + 1];
    signal roots[MAX_DEPTH];
    ...
    for (var i = 0; i < MAX_DEPTH; i++) {
        var isDepth = IsEqual()([depth, i]);   // ← constraint added every level
        roots[i] <== isDepth * nodes[i];       // ← constraint added every level
        ...
        nodes[i + 1] <== Poseidon(2)(...);     // ← Poseidon added every level
    }
    ...
}
```

**All `MAX_DEPTH` Poseidon hash calls are instantiated unconditionally.** R1CS circuits
cannot branch; the "dynamic depth" is emulated by multiplying each intermediate root by a
selector (`IsEqual`) and summing the result. The Poseidon hashers for the unused levels
still execute; their outputs are just multiplied by zero.

Compared to the fixed-depth `MerkleTreeChecker(levels)`:

- The fixed-depth template adds `levels` Poseidon instances — no overhead per level.
- `BinaryMerkleRoot(MAX_DEPTH)` adds `MAX_DEPTH` Poseidon instances **plus** one
  `IsEqual` comparator and two multiplier constraints per level.

`IsEqual` in circom is itself a small sub-circuit (roughly 3 constraints). So the overhead
for a 20-level LeanIMT versus a fixed-depth-20 tree is approximately
`20 × 3 ≈ 60` extra constraints — marginal, but the wrong direction.

## Constraint and proving-time analysis

### Baseline: Sharibo at depth 4

From `NOTES.md` and the compiled circuit:

| | Value |
|---|---|
| Poseidon(2) constraint count (BLS12-381 field) | ~363 per call |
| Merkle hash calls at depth 4 | 4 |
| Commitment hash (leaf) | 1 |
| Nullifier hash | 1 |
| Total Poseidon calls | 6 |
| Non-linear constraints | 1,470 |
| Linear constraints | 1,644 |
| R1CS constraints reported in UI | **1,452** |
| Powers-of-Tau required | 2¹² |

### Fixed-depth tree at depth 20 (scaling to large groups)

Poseidon path verification constraints scale linearly with depth. From published benchmarks
([Ethereum Research, 2020](https://ethresear.ch/t/gas-and-circuit-constraint-benchmarks-of-binary-and-quinary-incremental-merkle-trees-using-the-poseidon-hash-function/7446)):

| Depth | Path verification constraints (Poseidon binary, BN254) |
|---|---|
| 4 | ~876 |
| 10 | ~2,190 |
| 20 | ~4,380 |

These are BN254 numbers. Our Poseidon255 (BLS12-381 scalar field) uses a different
round configuration (8 full + 56 partial rounds, x⁵ S-box) and produces a higher per-call
constraint count (~363 vs ~219 on BN254). Scaling accordingly:

| Depth | Estimated Sharibo circuit constraints (BLS12-381) |
|---|---|
| 4 | ~1,452 (measured) |
| 10 | ~3,267 |
| 20 | ~5,997 |

### LeanIMT at MAX_DEPTH 20, actual depth 3 (5 members, 2³ = 8 ≥ 5)

A 5-member circle fits in a tree of depth 3 (8 leaves). With `BinaryMerkleRoot(20)`:

- Poseidon calls: 20 (all levels always execute) → same as a fixed-depth-20 tree.
- Extra overhead: 20 × IsEqual ≈ +60 constraints.
- **Result: more constraints than a fixed-depth-20 tree, not fewer.**

Compared to the current fixed-depth-3 tree the 5-member circle actually needs:

| Configuration | R1CS constraints (est.) | Δ vs current depth 4 |
|---|---|---|
| Fixed depth 4 (current) | 1,452 | — |
| Fixed depth 3 (optimal for 5 members) | ~1,089 | −363 (−25 %) |
| LeanIMT MAX_DEPTH 20 | ~6,057 | +4,605 (+317 %) |
| LeanIMT MAX_DEPTH 10 | ~3,327 | +1,875 (+129 %) |

### Proving-time implication

Groth16 proving time scales roughly linearly with constraint count (the dominant cost is
multi-scalar multiplication over the constraint count). The Sharibo bench harness
(`packages/client/bench/prove.bench.ts`) has not yet been run against a built circuit on
this machine, so we cannot report measured milliseconds. However the constraint-count
ratios above are well-established and the inference is direct:

- A 5-member circle at fixed depth 3 would prove **~25% faster** than depth 4.
- The same circle with `BinaryMerkleRoot(MAX_DEPTH=20)` would prove **~4× slower**
  than the current depth-4 circuit.
- The depth-20 overhead arises entirely from the 17 extra (no-op but still constrained)
  Poseidon instances that LeanIMT cannot avoid in a Groth16 R1CS.

Semaphore's own benchmark page notes that v4 (LeanIMT) is faster than v3 for *proof
generation* — but that improvement is primarily due to their new identity schema and a
move to BabyJubJub + EdDSA. Their tree depths start at 16 in v3; a depth-3 group in v4
with LeanIMT at MAX_DEPTH=20 is still slower than a fixed-depth-3 circuit.

## Contract impact

Confirmed: the Soroban contract (`contracts/sharibo/src/lib.rs`) stores `Circle.root` as
an opaque `Fr` field element and runs only the Groth16 pairing check. It is fully
indifferent to whether the root came from a fixed-depth or LeanIMT tree. **No contract
changes are needed for any tree construction on the client side.**

The verification key (`VerificationKey`) is circuit-specific — a new circuit (different
template or different `MAX_DEPTH`) requires a new trusted setup and a new VK committed at
`create_circle` time. That cost exists regardless of which tree style is chosen.

## Options considered

### Option A: Keep fixed depth 4, do nothing (current state)

- 1,452 constraints, depth 4, 16-leaf capacity.
- 5-member circles waste 11 leaf positions but the proving cost is trivially low already
  (seconds in-browser, well under 50% of the Soroban CPU budget on-chain).
- Growing beyond 16 members requires a new compile + trusted setup, but Sharibo's ROSCA
  model caps groups at a small, fixed size (5 for the demo; configurable at deploy time
  via `create_circle`).

### Option B: Reduce to fixed depth 3 (optimal for 5 members)

- Drops from depth 4 to depth 3: capacity 8, fits exactly 5–8 members.
- ~25% fewer constraints, slightly faster proving.
- Requires `npm run setup` (new trusted setup) and redeploying circles.
- The change is one line in `circuits/config.json`.

### Option C: Adopt LeanIMT at MAX_DEPTH 20

- Adds ~4,600 constraints for a 5-member circle.
- Adds the `@zk-kit/lean-imt` dependency to the client package.
- Requires sourcing or writing a BLS12-381-compatible `BinaryMerkleRoot` circom template
  (the canonical one uses BN254 Poseidon; we would need the BLS12-381 variant).
- Provides genuine flexibility for groups larger than 16 members without a new trusted
  setup — but at a ~4× proving-time penalty for small groups.
- Semaphore v4 ships one zkey per supported depth (1–32); that is the production pattern
  for "flexible depth" under Groth16. It is not a single circuit.

### Option D: Adopt LeanIMT at a modest MAX_DEPTH (e.g. 10, capacity 1024)

- ~2× the current constraint count.
- A reasonable trade-off if groups grow into the hundreds.
- Still requires a new trusted setup and the BLS12-381 template port.

## Decision

**Reject LeanIMT for now. The framing of the issue contains a false premise.**

The issue states "a five-member circle at depth 4 pays for 16 leaves' worth of hashing."
This is true of the *off-chain tree construction* (which hashes 11 zero-padded nodes), but
not of the *circuit*: the circuit pays for exactly `levels` Poseidon calls regardless of
how many leaves are occupied. Depth 4 already means 4 hashes, not 16.

More importantly, replacing the fixed-depth circuit with a LeanIMT circuit compiled at
`MAX_DEPTH=20` makes the 5-member proving *slower*, not faster — by approximately 4×,
because the circuit must still instantiate and constrain all 20 levels.

The only way LeanIMT delivers a proving-time saving for small groups is if `MAX_DEPTH` is
set to the *actual depth needed* — which is identical to just using a fixed-depth circuit
at that depth. The "dynamism" of LeanIMT is entirely in the off-chain tree data structure
and the on-chain root accumulation (cheaper insertions). Inside the Groth16 constraint
system, depth is fixed at compile time.

**Immediate action: Option B (reduce to depth 3) is the correct optimisation for the
5-member demo**, costing nothing but a config change and re-setup. This is out of scope
for this ADR and should be tracked as a separate issue if the 25% proving-time saving is
considered worthwhile.

**Future consideration: Option D (MAX_DEPTH 10) is worth revisiting** if Sharibo
supports dynamic group sizes (e.g. circles with 10–100 members). At that point, the
constraint overhead (~2× vs current) is the cost of not needing a new trusted setup per
group size, which may be worth paying.

## Consequences

- No code changes in this ADR.
- The fixed-depth tree at depth 4 is retained.
- `BinaryMerkleRoot(MAX_DEPTH)` from zk-kit.circom is not ported or adopted.
- Future work: if groups grow beyond 16 members, open a new issue to evaluate Option D
  with actual proving-time measurements against a compiled BLS12-381 BinaryMerkleRoot
  circuit.
- The bench harness (`npm run bench:prove`) exists and is ready; whoever opens that future
  issue should run it against both a fixed-depth-N and a `BinaryMerkleRoot(N)` circuit
  compiled on the BLS12-381 prime and record the numbers in the bench file's baseline
  table before making a recommendation.

## References

- [zk-kit BinaryMerkleRoot circom source](https://github.com/privacy-scaling-explorations/zk-kit.circom/blob/main/packages/binary-merkle-root/src/binary-merkle-root.circom)
- [Semaphore v4 circuit](https://github.com/semaphore-protocol/semaphore/blob/main/packages/circuits/src/semaphore.circom)
- [Semaphore v4 benchmarks](https://docs.semaphore.pse.dev/benchmarks)
- [Gas and circuit constraint benchmarks of binary and quinary IMTs (Ethereum Research, 2020)](https://ethresear.ch/t/gas-and-circuit-constraint-benchmarks-of-binary-and-quinary-incremental-merkle-trees-using-the-poseidon-hash-function/7446)
- [LeanIMT HackMD explainer](https://hackmd.io/@vplasencia/S1whLBN16)
- Sharibo `NOTES.md` — measured constraint counts for the current depth-4 circuit
