# Sharibo Smart Contracts

This directory contains the Soroban smart contracts for **Sharibo**, private rotating savings circles on Stellar. The payout of the shared pot is anonymized by a real Groth16 zero-knowledge proof, verified on-chain.

| Method          | Kind  | Purpose                                                            |
| --------------- | ----- | ------------------------------------------------------------------ |
| `create_circle` | write | Admin creates a circle (Merkle root, contribution, size, vk, fee).  |
| `fund`          | write | Deposit one `contribution` into the current round's pot.           |
| `claim`         | write | Pay the pot (minus protocol fee) to `recipient` given a valid proof.|
| `get_circle`    | view  | Read circle state.                                                 |
| `has_claimed`   | view  | Whether a nullifier has already been used in this circle.          |

---

`fund(circle_id, from)` requires only `from.require_auth()` — **any address may fund any circle**. The Merkle tree constrains who may _claim_, not who may _fund_.

Before compiling the contracts, ensure you have the proper Rust toolchain installed.

### Prerequisites

- **Rust + WASM target**:
  ```bash
  rustup target add wasm32v1-none
  ```
- **Stellar CLI**: Ensure you have installed the current `stellar` CLI (superseding the old `soroban` CLI).

### Build Command

To build the contract and compile it to WebAssembly (WASM):

```bash
stellar contract build
```

The compiled WASM artifact will be generated at `target/wasm32v1-none/release/sharibo.wasm`.

---

1. Iterates `circle.contributors` (addresses that funded the _current_ round, stored in insertion order) and transfers `contribution` back to each funder.
2. Sets `circle.cancelled = true` and clears `circle.pot` and `contributors`.
3. Permanently closes the circle: subsequent `fund` and `claim` calls revert with `Error::CircleCancelled`.

**Privacy note**: contributor addresses are already public (funding is unshielded). Storing and iterating them for refunds imposes no additional privacy loss _today_. However it constrains a future shielded-funding design, which would need to avoid recording funder addresses on-chain — see issue #82.

To execute the test suite, run the following command from the `contracts/` directory:

## Storage lifetime

Every write entrypoint (`create_circle`, `fund`, `claim`, `cancel_circle`) calls `extend_ttl` on all touched persistent and instance entries. The two constants governing this behaviour are defined and justified in [`contracts/sharibo/src/lib.rs`](sharibo/src/lib.rs):

| Constant | Value | Wall-clock equivalent |
| --- | --- | --- |
| `LEDGER_THRESHOLD` | 100 ledgers | ≈ 8 minutes |
| `LEDGER_EXTEND_TO` | 500,000 ledgers | ≈ 29 days |

The Soroban network maximum for persistent entry TTL is **535,679 ledgers (≈ 30 days)** ([Stellar CLI docs](https://developers.stellar.org/docs/tools/cli/cookbook/extend-contract-wasm)). `LEDGER_EXTEND_TO` is set below that ceiling intentionally, giving a small safety margin while keeping circles live for as long as the network allows.

**What this means in practice**: as long as any participant calls `fund`, `claim`, or `cancel_circle` at least once every 29 days, the circle's storage entry is refreshed and the circle stays accessible indefinitely.

**What to do if a circle goes dormant**: if no write has occurred for longer than the TTL window, the persistent entry will be archived. Before interacting with the circle again, an operator must restore it:

```bash
stellar contract restore \
  --source <admin-or-any-account> \
  --network mainnet \
  --id <contract-id>
```

After a successful `RestoreFootprintOp` the circle's full state (including `round`, `pot`, and `contributors`) is restored with the values it had when it was archived. No data is lost; the circle can then be used normally and the next write will re-extend the TTL to another 29-day window.

`NextCircleId` lives in **instance storage** (`env.storage().instance()`). Soroban instance entries have a TTL measured in ledgers; once a TTL lapses the entry is _archived_ (removed from the live state) and can be restored later via `RestoreFootprintOp`.

**What happens on testnet when instance storage is archived and restored?** After a successful `RestoreFootprintOp` the entry reappears with its last-written value intact — the counter does _not_ reset. The risk is the gap between archival and restoration: any `create_circle` call during that gap would reinitialise the counter to `0` (the `unwrap_or(0)` default), silently overwriting circle 0.
**Storage archival:** every entry the contract writes — instance (`NextCircleId`) and persistent (`Circle`, `Nullifier`) — has its own TTL-extension and archival-consequence analysis, including the `NextCircleId` reset-to-zero risk and the more sensitive nullifier double-claim fence. See [`docs/adr/004-storage-archival.md`](../docs/adr/004-storage-archival.md).

---

## 3. Deploying the Contracts

### Required CLI

Deployments are performed using the `stellar` CLI.

### Deployment Commands

1. **Deploy the WASM contract onto Testnet**:
   ```bash
   stellar contract deploy \
     --wasm target/wasm32v1-none/release/sharibo.wasm \
     --source admin \
     --network testnet
   ```
   *This command returns the Contract ID (e.g., `CB64IZIBBSPUY63UMIVACKWDKRFNH6WJ2EPAOLM7QR4ZI6IJOT4N2LCF`), which should be recorded in your environment variables.*

2. **Retrieve the Test Token ID (using native XLM Stellar Asset Contract on Testnet)**:
   ```bash
   stellar contract id asset --asset native --network testnet
   ```

---

## 4. Contract API Reference

Below is the documentation for all public contract methods.

### `create_circle`

* **Signature**:
  ```rust
  pub fn create_circle(
      env: Env,
      admin: Address,
      token: Address,
      root: Fr,
      contribution: i128,
      size: u32,
      round_deadline_ledgers: u32,
      vk: VerificationKey,
      fee_bps: u32,
      fee_recipient: Address,
  ) -> u64
  ```
  (See [`docs/adr/003-protocol-fees.md`](../docs/adr/003-protocol-fees.md) for
  the fee design.)

* **Purpose**:
  Allows an administrator to initialize a new rotating savings circle with a designated payment token, Merkle root containing member commitments, expected contribution amount per member, total circle size (number of members), an optional round deadline (in ledgers), and the Groth16 verification key (`vk`). `fee_bps` (0–10,000 basis points; `0` = no fee) and `fee_recipient` commit an immutable protocol fee paid out of the pot on each `claim`.

* **Preconditions**:
  * The admin must authorize the transaction (`admin.require_auth()`).
  * The contribution amount and circle size must be valid and must not result in an integer overflow when multiplied to determine the pot target.
  * `fee_bps` must be `<= 10_000` (`Error::InvalidFeeParams` otherwise), and when `fee_bps > 0` the `fee_recipient` must not be the contract itself (`Error::InvalidRecipient`).

---

### `fund`

* **Signature**:
  ```rust
  pub fn fund(env: Env, circle_id: u64, from: Address)
  ```

* **Purpose**:
  Deposits exactly one `contribution` amount of tokens into the designated circle's pot for the current round.

* **Preconditions**:
  * The funder must authorize the transfer (`from.require_auth()`).
  * The circle associated with `circle_id` must exist and must **not** be cancelled.
  * The current round's pot must not be full. If the pot has already reached the target (`contribution * size`), further contributions are blocked.
  * The funder must hold a sufficient balance of the circle's configured token.

* **Open Funding Design**:
  Funding is intentionally unshielded and public. Any address can call `fund` on behalf of a circle (not restricted to Merkle root members). This allows external benefactors to top up community pots.

---

### `claim`

* **Signature**:
  ```rust
  pub fn claim(
      env: Env,
      circle_id: u64,
      recipient: Address,
      nullifier_hash: Fr,
      external_nullifier: Fr,
      proof: Proof,
  )
  ```

* **Purpose**:
  Anonymously pays out the round pot (`contribution * size` minus the
  committed protocol fee) to the designated `recipient` address upon
  presenting a valid Groth16 zero-knowledge proof of membership. `claim`
  splits the pot with `apply_fee`: `fee` bps goes to
  `circle.fee_recipient` (the fee transfer is skipped entirely when
  `fee_bps = 0`, keeping the `claim` CPU cost identical to a no-fee
  circle), and the net goes to `recipient`. The `claimed` event reports
  the full pot.

* **Preconditions**:
  * The circle associated with `circle_id` must exist and must **not** be cancelled.
  * The pot must be fully funded (`pot == contribution * size`).
  * The provided `external_nullifier` must match the expected SHA-256 round tag of the current round, computed as `SHA256(circle_id, round) mod r`. This binds the proof to the exact circle and round.
  * The `nullifier_hash` must **not** have been previously used for any claim in this circle.
  * The Groth16 ZK proof must verify successfully against the circle's stored verification key (`vk`) and public inputs (`[nullifier_hash, root, external_nullifier]`).

* **Postconditions**:
  * The nullifier hash is marked as spent in persistent storage.
  * The entire pot balance is transferred to the `recipient` address.
  * The circle's `pot` is reset to `0`, the `round` is incremented by `1`, and the `contributors` list is cleared.

---

### `get_circle`

* **Signature**:
  ```rust
  pub fn get_circle(env: Env, circle_id: u64) -> Circle
  ```

* **Purpose**:
  A view method to retrieve the complete public state and configuration of a circle (e.g., admin, token, Merkle root, round, current pot, and contributors).

* **Preconditions**:
  * The circle associated with `circle_id` must exist.

### Events

Every state-changing entrypoint emits a contract event so off-chain observers can react without polling `get_circle`.

| Entrypoint | Topics | Data |
| --- | --- | --- |
| `create_circle` | `("circle", "created", circle_id)` | `(admin, token, contribution, size)` |
| `fund` | `("circle", "funded", circle_id)` | `(from, new_pot, target)` |
| `claim` | `("circle", "claimed", circle_id)` | `(round, amount, recipient)` |
| `cancel_circle` | `("circle", "cancelled", circle_id)` | `(refunded_count, refunded_total)` |

The `claim` event deliberately omits the nullifier hash: publishing it would give observers a linkability handle for correlating anonymized payouts.

---

## 5. Error Code Reference

When a transaction reverts, Soroban returns a typed contract error of the form `Error(Contract, #Code)`. The canonical mapping — covering all eight current codes with SDK class, user-facing message, likely cause, and remedy — is in **[`docs/errors.md`](../docs/errors.md)**.

| Code | Error Name | Trigger / Cause | What the Caller Should Do |
| :---: | :--- | :--- | :--- |
| **1** | `CircleNotFound` | The specified `circle_id` does not exist in persistent storage. | Verify that the circle ID is correct and was successfully created. |
| **2** | `RoundNotFunded` | `claim` was called on a circle whose pot has not yet reached the required target size (`contribution * size`). | Ensure that the required number of contributors have successfully called `fund` for this round. |
| **3** | `WrongRoundTag` | The presented `external_nullifier` does not match the expected SHA-256 round tag (`SHA256(circle_id, round) mod r`) of the current round. | Re-generate the proof with the correct round tag matching the circle's current round number. |
| **4** | `AlreadyClaimed` | The `nullifier_hash` presented in `claim` has already been recorded in persistent storage as claimed. | Do not attempt to reuse a spent nullifier. Each member may only claim once per circle/round. |
| **5** | `InvalidProof` | The Groth16 pairing check failed, or the public signal order/values did not match the proof statement. | Verify that the zero-knowledge proof was correctly generated, utilizing the correct secret, nullifier, path elements, and verification key. |
| **6** | `RoundFull` | `fund` was called on a circle whose pot is already fully funded. | Wait for the current round to be claimed and advanced before attempting to fund the next round. |
| **7** | `Overflow` | Checked arithmetic failed during contribution calculation or pot addition. | Avoid using absurdly large contribution amounts or circle sizes that overflow integer capacities. |
| **8** | `CircleCancelled` | `fund`, `claim`, or `cancel_circle` was called on a circle that has already been cancelled. | Do not interact with a cancelled circle. Any funds were already refunded to the contributors. |
| **9** | `InvalidCircleParams` | `create_circle` was given a zero size, a non-positive contribution, an invalid verification key length, or a creation-time overflow in `contribution * size`. | Correct the circle configuration before submitting the transaction. |

---

## 6. Test Coverage

The accompanying test suite in [`contracts/sharibo/src/test.rs`](sharibo/src/test.rs) contains **21 tests** verifying the correctness and robustness of the smart contract's state machine, ZK-verification path, and auxiliary mechanisms.

### Key Scenarios Covered

1. **Happy Path Payout**:
   - `happy_path_round_pays_out_and_advances`: Verifies that a fully funded round with a real valid Groth16 proof successfully transfers the pot to a fresh recipient, resets the pot, and increments the round.
2. **Rejection & Error Paths**:
   - `claim_reverts_on_tampered_public_input`: Verifies that `claim` panics with `Error::InvalidProof` when a tampered or invalid nullifier hash is submitted.
   - `claim_reverts_when_underfunded`: Ensures that a claim fails with `Error::RoundNotFunded` if any of the members have not funded.
   - `second_claim_with_same_nullifier_reverts`: Asserts that a nullifier cannot be replayed across rounds, reverting with `Error::AlreadyClaimed`.
   - `claim_reverts_on_stale_round_tag`: Asserts that providing a round tag for a different round reverts with `Error::WrongRoundTag`.
3. **Authorization**:
   - `create_circle_requires_admin_auth` and `fund_requires_member_auth`: Enforces that admin and funder authorizations are properly checked.
4. **Edge Cases**:
   - `sixth_fund_on_full_round_reverts`: Verifies that a sixth deposit on a 5-member circle is blocked with `Error::RoundFull` to prevent over-funding and bricking the claim.
   - `anyone_can_fund`: Verifies the open funding model, ensuring non-member addresses can contribute to a pot.
   - `fund_reverts_on_pot_target_overflow`: Ensures checked multiplication catches overflows.
5. **Cancellations & Refunds**:
   - `cancel_refunds_partial_funders_and_closes_circle`: Verifies that a circle admin can cancel an underfunded circle, automatically refunding all current round contributors in FIFO order and closing the circle permanently.
6. **State Persistence**:
   - `instance_ttl_extended_after_create_fund_claim`: Ensures that `extend_ttl` is executed on all write operations (`create_circle`, `fund`, `claim`) to prevent instance-storage archival issues.
   - `persistent_circle_survives_multiple_rounds_with_ttl_refresh`: Verifies that Circle and Nullifier entries remain accessible across multiple fund/claim rounds when ledger advances by LEDGER_THRESHOLD, confirming TTL is actively re-extended (not once-at-creation).
   - `circle_and_nullifier_entries_individually_extended`: Asserts that both the Circle persistent entry AND the Nullifier persistent entry are independently extended, surviving ledger advancement past LEDGER_THRESHOLD.
   - `ttl_survives_fund_after_ledger_advance`: Confirms that fund operations trigger TTL re-extension even after ledger has advanced past LEDGER_THRESHOLD, allowing indefinite circle activity.
7. **Gas / CPU Benchmarking**:
   - `cpu_instruction_benchmarks`: Benchmarks and prints the precise CPU instructions consumed by write operations (e.g., `create_circle`, `fund`, `claim`) and asserts that they remain safely under the 100M limit.

### TTL (Time-To-Live) & State Archival

The contract uses Soroban's ledger TTL mechanism to manage circle entry lifespan. The following constants govern TTL behavior:

- **`LEDGER_THRESHOLD = 100`**: The minimum ledger distance at which an entry's TTL should be re-extended. At ~5 seconds per ledger, this is ~8.3 minutes. Active circles are re-extended every ~500 seconds of operation.
- **`LEDGER_EXTEND_TO = 500_000`**: The target TTL (in ledgers) after each extension. At ~5 seconds per ledger:
  ```
  500_000 ledgers × 5 sec/ledger = 2_500_000 seconds ≈ 28.9 days ≈ 29 days
  ```
  This gives circles **~1 month of inactivity** before archival risk.

#### Archival & Restoration

If a circle's persistent entry (or any Nullifier) is not written to for 29+ days:

1. **Archival**: The entry moves to the Soroban state archive (temporary inaccessibility). On-chain reads/writes fail with `CircleNotFound`.
2. **Restoration**: The entry can be restored via `RestoreFootprintOp` on the Stellar network (Ledger 50M+ supports historical recovery).
3. **Recovery**: Restoration is **permissionless** — any party can restore an archived circle; no admin key is needed (only network validator consensus).
4. **State Preservation**: Upon restoration, the entry reappears with its last-written value intact (round number, pot, contributors, etc. are preserved).

See the [Soroban Documentation](https://developers.stellar.org/) for "Temporary State" and "State Archival" (Soroban 23.0+).
  - `cpu_instruction_benchmarks`: Benchmarks and prints the precise CPU instructions consumed by write operations (e.g., `create_circle`, `fund`, `claim`) and asserts that they remain safely under the 100M limit.

### Running Coverage (LLVM / Rust)

You can generate coverage reports for the Rust contract using `cargo-llvm-cov`. Install it and then run the coverage collection from the `contracts/` directory:

```bash
# Install the tool (once)
cargo install cargo-llvm-cov

# From the repository root
cd contracts

# Run tests and produce coverage reports (HTML + lcov)
cargo llvm-cov --workspace --tests --lcov --output-path coverage --html

# Combined coverage will be written to `contracts/coverage/` (open the HTML report in a browser).
```

Note: `cargo-llvm-cov` depends on LLVM tooling available in your environment. See the `cargo-llvm-cov` documentation for platform-specific notes.
