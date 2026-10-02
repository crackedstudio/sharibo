# Wire Format Specification

The circuit (`circuits/membership.template.circom`), the contract
(`contracts/sharibo/src/lib.rs`), and the client SDK
(`packages/client/src/`) each encode the same on-chain data independently.
If they disagree, the pairing check silently fails with `InvalidProof` —
there is no version negotiation and no early warning.

This document is the single source of truth for every byte-level encoding
that must agree across all three implementations. Each implementation
points here instead of describing the format inline.

**Validated by:** committed test vectors in `test-vectors/wire-format.json`
and the cross-implementation tests that consume them.

---

## 1. Public signal order

Groth16 public signals are the values the verifier receives alongside the
proof. Sharibo has **3** public signals.

**Order (index → signal):**

| Index | Signal              | Origin                  | Role in `verify_groth16` |
| ----: | :------------------ | :---------------------- | :----------------------- |
|     0 | `nullifierHash`     | Circuit **output**      | `public_inputs[0]`       |
|     1 | `root`              | Circuit declared public | `public_inputs[1]`       |
|     2 | `externalNullifier` | Circuit declared public | `public_inputs[2]`       |

**Why this order:** circom/snarkjs emit all outputs of `component main`
first (here, `nullifierHash`), then the explicitly declared public
inputs in the order they appear in `component main { public [...] }`
(here, `root`, then `externalNullifier`). The `component main` line in
the generated circuit reads:

```circom
component main { public [root, externalNullifier] } = Sharibo(4);
```

Outputs come before inputs in snarkjs's `public.json`, so the actual
emission order is `[nullifierHash, root, externalNullifier]` — not the
more intuitive `[root, externalNullifier, nullifierHash]` a naive reading
of the source might suggest.

**Where each implementation uses this order:**

- **Circuit** (`membership.template.circom`): `signal output nullifierHash`
  declared after the public inputs; `component main { public [root, externalNullifier] }`.
  snarkjs emits them in output-then-input-declaration order.
- **Contract** (`lib.rs`, `claim`): `let public_inputs = vec![nullifier_hash, root, external_nullifier]`.
- **Client** (`prove.ts` → `contract.ts`): `claim` passes `nullifierHash`,
  `root`, `externalNullifier` to the contract's `claim` entrypoint in that
  order.

**Adding a new public signal:** append it to the end of the
`public_inputs` vector in `lib.rs`, add the corresponding `signal input`
_after_ the existing public inputs in the template, and regenerate
`component main { public [...] }` via `scripts/gen-circuit.cjs`. The new
signal gets the next index. Run `test-vectors/generate.mjs` to refresh
the committed vectors, then re-run the full test suite (circuit tests,
contract tests, client tests) to confirm the three implementations still
agree.

---

## 2. External nullifier derivation

The external nullifier binds a proof to a specific `(circle_id, round)`
tuple. It is derived **outside** the circuit (in the contract and in the
client), not as a circuit constraint — the circuit accepts any field
element as `externalNullifier` and happily produces a witness for it.

**Algorithm:**

```text
preimage = big_endian_u64(circle_id) ‖ big_endian_u32(round)
digest   = SHA-256(preimage)
value    = bytes_to_bigint(digest) mod r
```

Where:

- `circle_id` is a `u64` (8 bytes, big-endian)
- `round` is a `u32` (4 bytes, big-endian)
- `preimage` is exactly **12 bytes** (no length prefix, no padding)
- `SHA-256` produces a 32-byte digest
- `r` is the BLS12-381 scalar field modulus (see §5)
- `mod r` reduces the digest into the scalar field

**Why SHA-256, not Poseidon:** Soroban has a native accelerated
`sha256` host function but no native Poseidon. This derivation happens
outside the SNARK constraint system, where Poseidon's constraint
efficiency is irrelevant. Hand-porting Poseidon into pure Rust here
would provide no benefit. Poseidon is used only _inside_ the circuit
(commitment and nullifierHash), where it earns its keep.

**Implementations must agree on byte order:** Both the Rust
(`lib.rs::compute_external_nullifier`) and TypeScript
(`identity.ts::computeExternalNullifier`) implementations must
serialize `circle_id` and `round` as big-endian and concatenate them
into a 12-byte buffer before hashing. A little-endian serialization
would produce a different digest and the contract would reject the
client's proof with `WrongRoundTag`.

**Validated by:** `test-vectors/wire-format.json` → `externalNullifier`
section, and the known-answer test in
`packages/client/src/identity.test.ts` (`computeExternalNullifier
known-answer test for (0n, 0n)`), which pins the expected output
for `(circle_id=0, round=0)` and confirms client/contract agreement
(see also `contracts/sharibo/src/test.rs::real_external_nullifier_round0`).

---

## 3. G1/G2 point encoding

Groth16 proofs and verification keys contain BLS12-381 group elements.
Sharibo uses **uncompressed** encoding — no compression flag bit, no
point-at-infinity sentinel, no cofactor handling. Canonical field
elements naturally have their reserved flag bits at 0, so no manual
flag-bit manipulation is needed.

### G1Affine

**Length:** 96 bytes

```text
bytes = be_bytes(X) ‖ be_bytes(Y)
```

- `X`, `Y` are field elements (`Fq`) in the BLS12-381 base field.
- Each coordinate is **48 bytes**, big-endian, zero-padded on the left
  to exactly 48 bytes.

**Used for:** `Proof.a`, `Proof.c`, every element of `VerificationKey.ic`.

### G2Affine

**Length:** 192 bytes

```text
bytes = be_bytes(X.c1) ‖ be_bytes(X.c0) ‖ be_bytes(Y.c1) ‖ be_bytes(Y.c0)
```

- `X`, `Y` are extension field elements (`Fq2`) — each is a pair
  `(c0, c1)` where `X = c0 + c1·u`.
- Each component (`c0`, `c1`) is a base-field element: **48 bytes**,
  big-endian.
- The encoding order within each extension element is `c1` first, then
  `c0`. This matches Soroban's `G2Affine` internal layout and the
  widely-standardized ("ZCash-style") BLS12-381 serialization.

**Used for:** `Proof.b`, `VerificationKey.beta`, `VerificationKey.gamma`,
`VerificationKey.delta`.

### Fr (scalar field element)

**Length:** 32 bytes, big-endian, zero-padded to exactly 32 bytes.

Soroban's `Fr` type accepts this via `Fr::from_bytes`, which auto-reduces
mod `r`. The client SDK represents scalar field elements as JavaScript
`bigint` values; the Stellar SDK serializes them to 32-byte big-endian
`U256` values automatically when sending contract arguments.

**Used for:** `nullifier_hash`, `external_nullifier`, `Circle.root`.

---

## 4. Verification key structure

```text
VerificationKey {
    alpha:  G1Affine,       // 96 bytes
    beta:   G2Affine,       // 192 bytes
    gamma:  G2Affine,       // 192 bytes
    delta:  G2Affine,       // 192 bytes
    ic:     Vec<G1Affine>,  // each 96 bytes
}
```

### ic length rule

```text
ic.len() == number_of_public_signals + 1
```

For the current circuit (3 public signals): `ic.len() == 4`.

`ic[0]` is the "constant" basis point for the linear combination;
`ic[i]` for `i ≥ 1` corresponds to `public_inputs[i-1]`. The
`verify_groth16` function computes:

```text
vk_x = ic[0] + Σ (public_inputs[i] × ic[i+1])
```

then checks the standard Groth16 pairing equation:

```text
e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1
```

The contract guards `public_inputs.len() + 1 == vk.ic.len()` and
returns `false` (→ `InvalidProof`) if the lengths mismatch
(`lib.rs::verify_groth16`).

### Proof structure

```text
Proof {
    a: G1Affine,   // π_a
    b: G2Affine,   // π_b
    c: G1Affine,   // π_c
}
```

---

## 5. Field and curve parameters

| Parameter                | Value                                                                                                               |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------ |
| Curve                    | BLS12-381                                                                                                           |
| Scalar field modulus `r` | `0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001`                                                |
| `r` (decimal)            | `52435875175126190479447740508185965837690552500527637822603658699938581184513`                                     |
| `r` bit length           | 255                                                                                                                 |
| Poseidon parameters      | `poseidon-bls12381-circom` (circuit) / `poseidon-bls12381` (client), x^5 S-box, 8 full + 56 partial rounds, arity 2 |
| Groth16 backend          | snarkjs 0.7.6, compiled with `--prime bls12381`                                                                     |

---

## 6. Changing this checklist

If any of the following changes, **every file in this list must be
updated atomically** — a disagreement is silent until the pairing check
fails on-chain with `InvalidProof`.

| File                                           | What to update                                                                                                                                       |
| :--------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/wire-format.md`                          | This document — update the specification first.                                                                                                      |
| `test-vectors/wire-format.json`                | Regenerate fixtures to match the new format.                                                                                                         |
| `test-vectors/generate.mjs`                    | Update the generator if the derivation or encoding logic changed.                                                                                    |
| `circuits/membership.template.circom`          | Signal declarations, `component main { public [...] }` line (via `scripts/gen-circuit.cjs`).                                                         |
| `circuits/scripts/gen-circuit.cjs`             | The `component main` line generation logic.                                                                                                          |
| `contracts/sharibo/src/lib.rs`                 | `public_inputs` vector order in `claim`, `compute_external_nullifier`, `verify_groth16`, `VerificationKey`/`Proof`/`Fr`/`G1Affine`/`G2Affine` usage. |
| `contracts/sharibo/src/test.rs`                | Test fixtures (proof/vk coordinates, public signal order assertions).                                                                                |
| `packages/client/src/identity.ts`              | `computeExternalNullifier` (byte order, modulus reduction).                                                                                          |
| `packages/client/src/identity.test.ts`         | Known-answer tests for `computeExternalNullifier`.                                                                                                   |
| `packages/client/src/prove.ts`                 | Proof/vk encoding logic (if the encoding changed).                                                                                                   |
| `packages/client/src/prove.test.ts`            | Encoding tests.                                                                                                                                      |
| `packages/client/src/contract.ts`              | `claim` argument order.                                                                                                                              |
| `circuits/verification_key.json`               | The committed verification key (regenerated by `npm run setup`).                                                                                     |
| `circuits/test/membership.test.js`             | Public signal order assertions, external nullifier tests.                                                                                            |
| `packages/client/src/poseidon-vectors.test.ts` | Cross-implementation Poseidon fixtures.                                                                                                              |
| `full_product_breakdown.md`                    | §6 (circuit interface), §7 (contract verifier), §10 (cross-cutting invariants).                                                                      |
| `README.md`                                    | Public signal order bullet in "Invariants held across circuit / contract / client".                                                                  |
| `NOTES.md`                                     | Build log entry recording the change.                                                                                                                |

**After any change:** run the full verification chain in order:

1. `cd circuits && npm run compile && npm run setup && npm test`
2. `cd contracts && cargo test`
3. `cd packages/client && npx vitest run` (or `node --test src/*.test.ts`)
4. `node test-vectors/generate.mjs > test-vectors/wire-format.json.new && diff test-vectors/wire-format.json test-vectors/wire-format.json.new`

If step 4 shows diffs, the generator and the committed vectors are out of
sync — fix the generator or the implementation, not the vectors.

---

## 7. Test vector files

| File                            | What it covers                                                                                                       |
| :------------------------------ | :------------------------------------------------------------------------------------------------------------------- |
| `test-vectors/poseidon.json`    | Cross-implementation Poseidon2 fixtures (circuit ↔ client).                                                          |
| `test-vectors/wire-format.json` | External nullifier known-answer tests, G1/G2 encoding examples, public signal order fixtures, vk.ic length fixtures. |
| `test-vectors/generate.mjs`     | Regenerates `poseidon.json` from the client implementation.                                                          |

The committed test vectors are **not** regenerated to make failing tests
pass. If only one implementation fails after a dependency bump, the two
implementations have diverged — fix the divergence, not the vectors.

# Cross-layer wire format (circuit ↔ contract ↔ client)

Authoritative reference for **public signal order** and **byte encodings** used by Groth16 verification on Soroban. Any change here must land in the same change set across all three layers (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## Public signals (four, not three)

After trusted setup for the current `membership` circuit (including `recipientHash`, issue #266 / [ADR 006](adr/006-recipient-binding.md)), snarkjs emits **four** public signals in this **fixed order**:

```text
[nullifierHash, root, externalNullifier, recipientHash]
```

| Index | Name                | Role                                                                                                                         |
| ----- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0     | `nullifierHash`     | Circuit **output**: `Poseidon(identityNullifier, externalNullifier)`                                                         |
| 1     | `root`              | Public input: circle Merkle root                                                                                             |
| 2     | `externalNullifier` | Public input: round tag (must match contract-derived `SHA256(circle_id, round)` reduced into `Fr`)                           |
| 3     | `recipientHash`     | Public input: payout binding (squaring constraint in circuit; contract compares against `compute_recipient_hash(recipient)`) |

**Why this order:** Circom/snarkjs place the main component's public **outputs** first, then public **inputs** in source declaration order (`root`, `externalNullifier`, `recipientHash` in `membership.template.circom`). The order is **not** `[root, externalNullifier, nullifierHash]`.

**Contract `public_inputs` vector** (for `verify_groth16`) must match snarkjs index-for-index:

```text
[nullifier_hash, circle.root, external_nullifier, recipient_hash]
```

See `Contract::claim` in [`contracts/sharibo/src/lib.rs`](../contracts/sharibo/src/lib.rs).

**Verification key `ic` length:** `len(ic) == number_of_public_inputs + 1` (here: 5 elements for 4 public signals).

### Pinned tests

- Circuit: `circuits/test/membership.test.js` — `"public signals are pinned…"`
- Contract: `contracts/sharibo/src/test.rs` — `claim_reverts_on_tampered_public_input`, CPU benchmarks with 4 inputs

## Scalar field elements (`Fr`)

- **Field:** BLS12-381 scalar field (same modulus as `BLS12_381_FR_MODULUS` in soroban-sdk).
- **On-chain:** `soroban_sdk::crypto::bls12_381::Fr` — passed to `claim` as decimal integers in CLI/SDK; internally canonical field elements.
- **In proofs:** Public signals from snarkjs are decimal strings; the client converts to `bigint` for transaction args.
- **Reduction:** Contract uses `Fr::from_bytes` on 32-byte SHA-256 digests for `external_nullifier` and `recipient_hash` (automatic mod‑\(r\)). Client uses `% FR_MODULUS` after SHA-256 for the same digests — must stay aligned with contract byte layout for those hashes (see below).

### Round tag bytes (external nullifier)

Both sides hash **12 bytes**: `circle_id` as big-endian `u64` || `round` as big-endian `u32`. Contract: `compute_external_nullifier` in `lib.rs`. Client: `computeExternalNullifier` in `packages/client/src/identity.ts` (and `@sharibo/core`).

### Recipient hash bytes

Contract: SHA-256 over the recipient `Address` **XDR** encoding (`recipient.to_xdr(env)`), then `Fr::from_bytes`.

Client (current): SHA-256 over the **32-byte ed25519 public key** from StrKey decode (`computeRecipientHash`). Test fixtures and committed proofs were generated with this client rule; **auditors should confirm byte-for-byte agreement with the contract** for every address type you support (muxed vs G-address, etc.). Any mismatch yields `InvalidProof` at pairing time.

## Groth16 proof (`Proof` struct)

| Part | Soroban type | Size      | Encoding                                                                                                          |
| ---- | ------------ | --------- | ----------------------------------------------------------------------------------------------------------------- |
| `a`  | `G1Affine`   | 96 bytes  | Uncompressed affine: `be(x) \|\| be(y)`, each 48-byte big-endian field element                                    |
| `b`  | `G2Affine`   | 192 bytes | Uncompressed affine over Fp²: `be(x₁) \|\| be(x₀) \|\| be(y₁) \|\| be(y₀)` (see snarkjs → contract mapping below) |
| `c`  | `G1Affine`   | 96 bytes  | Same as `a`                                                                                                       |

**Client encoders:** `encodeG1` / `encodeG2` in [`packages/client/src/prove.ts`](../packages/client/src/prove.ts).

**snarkjs → G2 layout:** snarkjs supplies `pi_b` as `[[x0,x1],[y0,y1]]` decimal strings. The contract expects limb order **`x1 || x0 || y1 || y0`**, each limb 48-byte big-endian (`encodeG2`).

## Verification key (`VerificationKey` struct)

Same G1/G2 rules as proof elements:

- `alpha`: G1 (96 bytes)
- `beta`, `gamma`, `delta`: G2 (192 bytes each)
- `ic`: array of G1, length `num_public_inputs + 1`

**Client:** `verificationKeyToContractFormat` in `packages/client/src/prove.ts` (from `circuits/verification_key.json`).

## Circuit artifacts (off-chain)

| Artifact         | Path                                                              | Role                           |
| ---------------- | ----------------------------------------------------------------- | ------------------------------ |
| R1CS / WASM      | `circuits/build/membership.r1cs`, `membership_js/membership.wasm` | Witness generation             |
| Proving key      | `circuits/build/membership_final.zkey` (local, not committed)     | `snarkjs groth16 fullProve`    |
| Verification key | `circuits/verification_key.json` (committed)                      | On-chain vk at `create_circle` |

## Related docs

- Curve choice: [ADR 005](adr/005-bls12-381-curve-choice.md)
- Recipient binding design: [ADR 006](adr/006-recipient-binding.md)
- CPU impact of extra public input: [contracts/BENCHMARKS.md](../contracts/BENCHMARKS.md)
- Troubleshooting encoding mismatches: [troubleshooting.md](troubleshooting.md)
