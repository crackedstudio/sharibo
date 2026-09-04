# Sharibo Contract CPU Instruction Benchmarks

This document details the CPU instruction consumption and budget analysis for the **Sharibo** Soroban smart contract operations on Stellar.

---

## 1. Overview & Constraints

Soroban enforces a hard per-transaction CPU instruction limit of **100,000,000 instructions (100M)**. Transactions that exceed this limit revert immediately on-chain regardless of the fee bid.

### Why BLS12-381 Instead of BN254

The standard Circom/Groth16 ZK stack traditionally targets the **BN254** curve. However, on Soroban:
- Stellar's host environment natively accelerates pairing and elliptic curve operations for **BLS12-381** via `env.crypto().bls12_381().pairing_check(...)`, `g1_add`, `g1_mul`, and related primitives.
- A pure-Rust implementation of BN254 pairing checks (such as using `ark-bn254` compiled to WebAssembly without host acceleration, per Stellar's `import_ark_bn254` example) consumes **~560 million CPU instructions for a single pairing**.
- Because Groth16 verification requires multiple pairing checks (structured as a product of pairings), verifying BN254 in pure Rust on Soroban is impossible within the 100M instruction cap.

By building the entire pipeline — Circom circuits, trusted setup, Poseidon hash parameters, smart contract, and client SDK — on **BLS12-381**, Sharibo achieves on-chain verification well within the protocol's instruction budget.

---

## 2. Benchmark Results

The smart contract includes automated instruction-budget tests in [`contracts/sharibo/src/test.rs`](sharibo/src/test.rs) (`cpu_instruction_benchmarks`).

### Measured CPU Instruction Costs

| Operation | Inputs / Parameters | Measured CPU Instructions | Protocol Limit | % of Limit |
| :--- | :--- | :--- | :--- | :--- |
| **`create_circle`** | Admin auth, SAC token address, Merkle root, contribution, size, BLS12-381 VK | **89,425** (~89K) | 100,000,000 | <0.1% |
| **`fund`** | Member auth, single SAC token transfer, vector push, pot update | **300,506** (~301K) | 100,000,000 | ~0.3% |
| **`claim` (Standard)** | Real Groth16 proof, 4 public inputs (`nullifier_hash`, `root`, `external_nullifier`, `recipient_hash`), SAC transfer | **51,507,065** (~51.5M) | 100,000,000 | ~51.5% |
| **`verify_groth16` (Synthetic Large IC)** | 5 public inputs (`ic.len() == 6`), 5 scalar multiplications | **54,589,179** (~54.6M) | 100,000,000 | ~54.6% |

---

## 3. Breakdown of the `claim` Operation

The `claim` entrypoint executes the complete zero-knowledge payout pipeline. Its ~51.5M CPU instruction budget is distributed as follows:

1. **Host Pairing Check (`bls12_381().pairing_check`)**:
   - Computes the 4-pairing product:
     $$e(-A, B) \cdot e(\alpha, \beta) \cdot e(vk_x, \gamma) \cdot e(C, \delta) == 1$$
   - Consumes **~30.3M instructions**.
2. **Linear Combination for Public Inputs (`g1_mul` / `g1_add`)**:
   - Computes $vk_x = ic[0] + \sum_{i=0}^{n-1} public\_input_i \cdot ic[i+1]$
   - For 4 public inputs, one scalar multiplication per signal, consuming **~18.3M instructions** total, plus minimal additions.
3. **Contract Logic, Authorization, & Asset Transfer**:
   - Target pot equality check (`pot == contribution * size`)
   - Round tag validation (`SHA256(circle_id, round) mod r`)
   - Nullifier double-claim check in persistent storage
   - Recipient hash binding check and fee settlement (if any)
   - Stellar Asset Contract (SAC) token transfer to `recipient`
   - State updates (pot zeroed, round incremented, contributors cleared) and storage TTL extension (`extend_ttl`)
   - Consumes **~2.9M instructions**.

---

## 4. Headroom & Safety Margin

- **Tested assertion**: The test suite enforces an explicit assertion that `claim()` CPU instructions remain strictly below **80,000,000** (a 20% margin below the 100M protocol ceiling).
- **Tree depth invariance**: The Merkle tree depth (e.g. depth 4 for 16 members, depth 7 for 100 members) only impacts circuit constraint count and proof generation time in the client; it does **not** increase on-chain verification cost because the contract only verifies the single Merkle root scalar.
- **Public input scaling**: Each additional public input in the circuit increases the contract verification cost by one scalar multiplication in $G_1$ (~4.6M instructions). With 4 public inputs, Sharibo operates comfortably in the ~51.5M range.

---

## 5. Running the Benchmarks Locally

To run the instruction benchmark harness and observe the exact instruction measurements on your machine:

```bash
cd contracts
cargo test cpu_instruction_benchmarks -- --nocapture
```

## Regenerating

This table is refreshed by the benchmark test:

```bash
just bench-contract
```

The committed values are generated from the current Soroban SDK and should be
reviewed whenever contract logic or dependencies change.

| Entrypoint | CPU instructions | Budget headroom |
| --- | ---: | ---: |
| `create_circle` | 89425 | 99.9% |
| `fund` | 300506 | 99.7% |
| `claim` | 51507065 | 48.5% |
| `verify_groth16` (5 public inputs) | 54589179 | 45.4% |

`claim` must remain below 80,000,000 instructions. Stellar's transaction CPU
budget is 100,000,000 instructions.