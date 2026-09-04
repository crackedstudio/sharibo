# Threat Model

Sharibo's README states what the ZK proof is doing and lists honest limitations. This document is the structured version: every property below names the code that enforces it, the test that exercises it, and the specific conditions under which it does *not* hold. Treat this as the canonical list of load-bearing guarantees — if a change touches any of the referenced code, this document should be updated in the same PR.

Scope: `contracts/sharibo/src/lib.rs`, `circuits/membership.template.circom`, `packages/client/`, and the demo entry points that call them (`scripts/e2e.ts`, `app/src/App.tsx`). Same scope as [SECURITY.md](../SECURITY.md).

## Assets

| Asset | What it means concretely |
|---|---|
| **The pot** | The token balance held by the contract for a circle's current round (`Circle.pot`), released in full to one `recipient` per `claim`. |
| **Member anonymity** | Given a successful claim, an observer should not learn *which* of the circle's members submitted the underlying proof. |
| **Round integrity** | Exactly one payout per funded round: no claim before the pot is fully funded, and no second payout from the same round's proof once one has already paid out. |

## Adversaries

| Adversary | Position | What they can see / do |
|---|---|---|
| **Outside chain observer** | Reads Horizon/RPC only, no keys, no circle membership. | Full public ledger state: `Circle` fields (`root`, `contribution`, `size`, `round`, `pot`, `contributors`), every `fund`/`claim` transaction's arguments and source account, event logs. Cannot see any member's `identityNullifier`/`identitySecret` or the mapping from a leaf to a real-world identity. |
| **Circle member** | Holds a valid `(identityNullifier, identitySecret)` leaf in the circle's tree. | Everything an outside observer sees, plus the ability to generate a real proof for their own leaf. Cannot forge a proof for another member's leaf (Merkle + Groth16 soundness) or replay their own proof into a later round (nullifier binding, see below). |
| **Circle admin** | Calls `create_circle`; address stored in `Circle.admin`. | Chooses `root`, `contribution`, `size`, and `vk` at creation time (`lib.rs:85-133`) — these are never revalidated by the contract afterward. Cannot block `fund` (only `from.require_auth()` is checked) or `claim` (no admin auth check at all — see `docs/adr/001-upgradeability.md:38-44`). Can call `cancel_circle` (`lib.rs:281-312`), which refunds the current round's contributors and permanently closes the circle. |
| **Contract deployer** | Deploys the Soroban WASM under the contract ID published in the README. | Controls the bytecode at deployment time only. `lib.rs` exposes no upgrade entry point, so post-deployment the deployer has no more power than any other observer (`docs/adr/001-upgradeability.md`, Decision §1). There is currently no published reproducible-build check, so a user must trust that the deployed WASM matches this repository's `contracts/sharibo/src/lib.rs` — this is a supply-chain gap, not a runtime one. |
| **Trusted-setup runner** | Ran the Powers-of-Tau + Groth16 setup that produced `circuits/verification_key.json` (`circuits/SETUP_TRANSCRIPT.md`, single contributor, 2025-07-01 entry). | If the setup's toxic waste was not destroyed, this party can construct a valid-looking proof for *any* circle using that vk without holding a real leaf in the tree at all — a full break of the membership property for those circles. This is the reason the setup is called out as single-party and non-production in [SECURITY.md](../SECURITY.md) and the README. |

## Security properties

### 1. Membership — "the claimant is a real, un-paid member"

**Mechanism.** The circuit's `MerkleTreeChecker` (`circuits/membership.template.circom:21-70`) constrains `Poseidon(identityNullifier, identitySecret)` to hash up to the declared `root` along a private path, with a booleanity constraint on each path index (`:45`) so a prover can't pick an out-of-range selector to fabricate an arbitrary hash input. The `Sharibo` template wires the private leaf into that check (`:99-110`). On-chain, `verify_groth16` (`lib.rs:339-368`) runs the real Groth16 pairing equation over BLS12-381 using Soroban's native `pairing_check`, against the `vk` stored on the `Circle` at creation.

**Tests.** `circuits/test/membership.test.js:74` (genuine member accepted), `:86` (wrong root rejected), `:92` (tampered path rejected), `:116` (non-boolean path index rejected). `contracts/sharibo/src/test.rs:194` (real proof accepted end-to-end), `:232` (tampered public input rejected — a real pairing failure, not a mock).

**Limits.**
- The verification key is supplied by whoever calls `create_circle`, per circle, and is never checked against a canonical hash on-chain (`lib.rs:85-93`). A circle admin who supplies a weak or malicious `vk` can make membership unverifiable or trivially satisfiable *for that circle* — the guarantee is only as strong as the vk the admin chose.
- If the trusted-setup toxic waste was not destroyed, the setup runner can forge a proof against the canonical vk regardless of tree contents (see Adversaries above).
- Poseidon-over-BLS12-381 constants come from a third-party package (`poseidon-bls12381`), cross-checked against Soroban's own field modulus but not independently audited — see README "Honest limitations".

### 2. No double claim — one payout per nullifier

**Mechanism.** `nullifierHash = Poseidon(identityNullifier, externalNullifier)` is emitted as a circuit output (`circuits/membership.template.circom:113-116`). The contract records it under `DataKey::Nullifier(circle_id, nullifier_hash)` and rejects any claim that reuses one (`lib.rs:213-217`, marked used at `:231`), independent of the pairing check.

**Tests.** `contracts/sharibo/src/test.rs:284` (`second_claim_with_same_nullifier_reverts`), `:548` (`has_claimed_false_before_true_after`).

**Limits.**
- `recipient` is a plain contract argument (`lib.rs:186`), not a circuit input — it is never bound to the proof (compare the circuit's signal list, `circuits/membership.template.circom:79-96`, which has no recipient signal at all; `circuits/test/membership.test.js:182` documents that the circuit does not bind the proof to any single expected value beyond what the verifier separately checks). Concretely: `(nullifier_hash, external_nullifier, proof)` is a valid claim for *any* `recipient`. If those values become visible before the original claim transaction is finalized — a careless or malicious relayer, or another party observing the pending transaction — anyone can resubmit the same tuple with a different `recipient` and redirect the payout. This is a payout-hijacking risk, not a privacy break: it costs the original claimant their payout, it does not deanonymize them. It's the same class of risk Tornado-Cash-style relayer designs address by adding the recipient (and a relayer fee) as a public input the circuit itself commits to; Sharibo does not do this today.
- In the demo, `claim` is always submitted through the admin's client (`scripts/e2e.ts:201`, `app/src/App.tsx:424,464`), which is exactly the delivery path where the above risk would surface first — the admin (or whoever holds that key) sees the proof and recipient before broadcasting and is a required relayer for the demo flow, even though `claim` itself has no `require_auth` call (`lib.rs:183-249`) and would accept submission from any account.

### 3. Round binding — a proof for round *N* cannot be used in round *N+1*

**Mechanism.** `externalNullifier = SHA256(circle_id, round) mod r`, computed identically by the client (`packages/client/src/identity.ts:63-90`) and the contract (`lib.rs:325-331`), deliberately outside the circuit (Soroban has accelerated SHA-256 but no native Poseidon; see the comment at `lib.rs:314-324`). The contract compares the proof's public `external_nullifier` signal against its own freshly computed expectation for `circle.round` before accepting a claim (`lib.rs:207-211`).

**Tests.** `contracts/sharibo/src/test.rs:328` (`claim_reverts_on_stale_round_tag`); `circuits/test/membership.test.js:98` (nullifier hash changes across rounds for the same identity).

**Limits.**
- The circuit itself does **not** constrain `externalNullifier` to any particular value — it will happily produce a witness for any value passed in (`circuits/test/membership.test.js:163,172,182`). Round binding is entirely an on-chain equality check (`lib.rs:207-211`), not an in-circuit constraint. A proof is only "for round N" because the contract refuses to accept any other `external_nullifier`, not because the SNARK enforces it.
- `external_nullifier` is derived from SHA-256 rather than Poseidon, a deliberate permanent choice (see `lib.rs:314-324`) — soundness here rests on SHA-256 collision resistance, not the circuit's algebraic constraints.

### 4. Unlinkability — the payout address can't be tied to a funder

**Mechanism.** `claim` transfers the pot to whatever `recipient` address is passed (`lib.rs:236-237`); nothing in the contract or circuit requires `recipient` to have funded the circle or to have appeared before. The demo always generates a fresh keypair for this purpose (`scripts/e2e.ts`: "Generating a FRESH recipient address"; `app/src/App.tsx:420-421`, `Keypair.random()`).

**Tests.** `scripts/e2e.ts` asserts the fresh recipient's balance delta equals exactly the pot and that it never appears among the five funders. There is no circuit or contract test for unlinkability specifically — it follows from `recipient` being unconstrained, not from a proof property.

**Limits.**
- **Funding is fully public, by design.** All five `fund` calls carry `from.require_auth()` (`lib.rs:143-181`) and are visible on-chain, including in the `Circle.contributors` list (`lib.rs:45`). Sharibo only anonymizes the *claim* side; anyone can already see who funded a given round. Shielding funding is out of scope for this design (README "Honest limitations", roadmap).
- Unlinkability is a property of *how the demo uses* an unconstrained field, not a property the proof cryptographically guarantees. Nothing stops a future caller from passing a `recipient` that *is* a known funder, which would (correctly) not break anything, but also means the contract itself enforces no unlinkability — only the client's choice to mint a fresh address does.
- The relayer/observer risk described under "No double claim" above applies here too: whoever submits the transaction sees the plaintext `recipient` before it lands on-chain.

## Property → code → test matrix

| Property | Enforcing code | Test evidence | Known limit |
|---|---|---|---|
| Membership | `membership.template.circom:21-70,99-110`; `lib.rs:339-368` | `membership.test.js:74,86,92,116`; `test.rs:194,232` | vk not pinned on-chain; single-party setup |
| No double claim | `lib.rs:213-217,231` | `test.rs:284,548` | recipient not bound to proof (front-run/hijack risk) |
| Round binding | `identity.ts:63-90`; `lib.rs:207-211,325-331` | `test.rs:328`; `membership.test.js:98` | binding is on-chain equality, not an in-circuit constraint |
| Unlinkability | `lib.rs:236-237` (unconstrained `recipient`) | `scripts/e2e.ts` fresh-recipient assertions | funding side is fully public; admin relays the claim tx in the demo |
| Token contract trust | `lib.rs:82` (`Circle.token` stored unvalidated) | none — accepted design risk | hostile token can refuse transfers, charge fees, or reenter; mitigation is out-of-band address verification by members |

## Token contract trust

**Status: accepted risk, documented mitigation.**

`create_circle` accepts a `token: Address` argument and stores it in `Circle.token` with no on-chain validation (`lib.rs:82`). Every subsequent `fund` and `claim` call invokes `token::Client::transfer` against that address unconditionally.

### Attacks a hostile token enables

| Attack | Mechanism | Consequence |
|---|---|---|
| **Selective transfer refusal** | Token's `transfer` succeeds for funders but reverts for the contract-as-sender during `claim`. | Pot is permanently stranded — members paid in but the payout is blocked. |
| **Fee-on-transfer** | Token silently credits the recipient less than the nominal amount (e.g. charges 0.1 % on each `transfer`). | `fund` deposits fall 1–N stroops short of `contribution`; `Circle.pot` is incremented by the full `contribution` but the contract's token balance is lower. `claim` requires `pot == contribution * size` *exactly* — even a 1-stroop shortfall means this equality never holds and the circle is permanently bricked. |
| **Reentrancy** | Token's `transfer` implementation calls back into `fund`, `claim`, or `cancel_circle` before returning. | The contract has no reentrancy guard. Soroban executes contracts in a single-threaded call stack so reentrancy is observable in the call tree, but it is not prevented. A carefully crafted token could re-enter `claim` before the nullifier is recorded (lines `lib.rs:431` records nullifier, `:441` calls transfer — the transfer happens *after* the nullifier write, which means the current ordering is safe against nullifier-based reentrancy; however the ordering is an implementation detail, not a contract invariant, and it should be documented as such). |
| **Silent no-op transfer** | Token's `transfer` returns `()` without moving any value. | `fund` increments `Circle.pot` in-memory and writes it back; `claim` pays out `circle.pot` stroops it believes are held. A no-op token decouples the accounting from the actual balance, allowing the pot to appear funded when no real tokens were ever deposited. |
| **Admin-extractable balance** | Token has a backdoor that lets its deployer drain balances held by other contracts. | The circle's entire pot can be extracted by the token's deployer at any time, independently of the nullifier/ZK checks. |

### Interaction with reentrancy ordering

In `claim` (`lib.rs`), the current execution order is: (1) record nullifier → (2) call `token.transfer`. Because the nullifier write happens *before* the external call, a reentrant `claim` with the same nullifier would be rejected by the `AlreadyClaimed` check on reentry. This ordering is load-bearing for reentrancy safety. Any future refactor that moves the `transfer` call before the `persistent().set(&nullifier_key, &true)` write would open a classic reentrancy window. This is noted here so reviewers know to treat that ordering as intentional.

### Mitigation

**Members** must verify the token address out of band before funding a circle. The expected check is: confirm the address matches a known, audited token contract (e.g. the native XLM SAC on testnet, or a well-known stablecoin on mainnet).

**The demo** pins the native XLM Stellar Asset Contract (`VITE_TEST_TOKEN_CONTRACT_ID`) and surfaces the token address with an explorer link in the funding UI so users can verify it before clicking Fund. The native XLM SAC is implemented in the Stellar host itself and cannot charge fees, refuse transfers, or reenter.

**The contract** cannot enforce this — validating a token address would require either a whitelist (centralisation) or an on-chain oracle for "is this a standard SAC?" (which doesn't exist). The correct boundary is social/UI: the circle creator publishes the token address; members verify it before joining.

This risk is analogous to the vk trust assumption (§1 above): the creator chooses the token, and members must trust or verify that choice.

## Out of scope

- **Network-level linkage.** Correlating a claim transaction's submitter IP, RPC session, or wallet-provider metadata back to a specific member. Nothing in this repo's contract or circuit code defends against this; it would need to be addressed at the transport/relay layer (e.g., a genuinely third-party relayer network), which does not exist yet.
- **Timing correlation.** Inferring which member claimed from *when* a proof was generated or submitted relative to funding events. Not modeled or defended against.
- **Testnet-only status.** Every on-chain artifact referenced in the README is testnet, using native testnet XLM as the pot asset. Mainnet-specific risks (real fund custody, gas-market front-running economics, ceremony participation incentives) are not analyzed here — see [SECURITY.md](../SECURITY.md) Limitations and Exclusions.

## Verifying these claims

Run the suites the matrix above cites:

```bash
cd circuits && npm test        # circuit-level properties
cd contracts && cargo test     # contract-level properties (8/8)
npm run e2e                    # unlinkability + round-binding, against live testnet
```

If any of the referenced line numbers drift out of sync with the code during a refactor, that's a signal this document needs a follow-up edit, not that the property has changed.
