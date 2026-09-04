# Mainnet readiness checklist

Sharibo is **testnet-only, no real funds** (see the banner in `app/src/App.tsx` and README
"Honest limitations"). This document lists what would have to be true before that changed. It is
a **checklist, not a timeline** — there are no target dates here, because any date would be
fiction. Every item links to the issue tracking it, or is marked **not yet filed** if no issue
exists.

**How to read this:** nothing below is checked off. Every item is either an open issue or has no
issue yet. That is the honest current state — a reader should come away able to judge how far
this project is from handling real funds, and the answer today is: far. Foundational analysis
work (the design and documentation half of several items) is done; the implementation and
verification half generally is not.

## Foundational work already done

These are closed issues / existing documents this checklist builds on — listed so it's clear
what groundwork already exists, as opposed to being silent about it:

- [`docs/threat-model.md`](threat-model.md) — the structured security-properties document (#23).
- [`docs/adr/001-upgradeability.md`](adr/001-upgradeability.md) — decision to stay immutable, admin rotation deferred (#92).
- [`docs/adr/002-multi-round-turn-ordering.md`](adr/002-multi-round-turn-ordering.md) — turn-ordering **design** (#91). Status is still **Proposed**, not Accepted or implemented — see "Product" below.
- [`docs/adr/004-storage-archival.md`](adr/004-storage-archival.md) — storage TTL/archival analysis, including the nullifier replay gap (#340).
- A multi-party trusted-setup **ceremony plan** was documented (#74, closed) — but the ceremony itself has not been run; the committed `verification_key.json` is still from a single-contributor setup (`circuits/SETUP_TRANSCRIPT.md`). See "Cryptographic" below.

## 1. Cryptographic

- [ ] **Run a genuine multi-party trusted-setup ceremony.** The plan is documented (#74, closed), but execution hasn't happened — the deployed vk is single-contributor. Until this runs, the setup runner is a full break of the membership property for every circle using that vk (`docs/threat-model.md` § Adversaries). *Tracking issue for the actual run: not yet filed.*
- [ ] **Independent third-party audit of the ZK circuit** (`circuits/membership.template.circom`). 🔒 **Hard prerequisite, not a nice-to-have** — nothing below substitutes for this. *Not yet filed.*
- [ ] **Bind the payout recipient to the proof.** Today `claim` accepts any `recipient` for a valid `(nullifier_hash, external_nullifier, proof)` tuple — a front-running/hijack risk, not a privacy break (`docs/threat-model.md` § "No double claim", limit 1). Core issue: #246. Candidate fixes: add `recipientHash` as a circuit public input (#266), or an arity-3 commitment binding a payout address at join time (#275). Narrower interim mitigation: reject `recipient == contract's own address` (#259). Risk write-up: #339.
- [ ] **Verification-key provenance and integrity.** Pin and document the provenance of the committed `verification_key.json` (#274); run `snarkjs zkey verify` as part of the setup script (#271); verify circuit artifact integrity before the app copies them into `public/` (#273).
- [ ] **Wire-format invariants** documented in one place, referenced from circuit, contract, and client, so a byte-encoding drift across languages can't reintroduce a silent proof-verification bug (#344).
- [ ] **Mutation testing for the SDK's crypto module** (#327) — raises confidence that the client-side crypto tests actually catch regressions, not just exercise the happy path.

## 2. Contract

- [ ] **Independent third-party audit of the Soroban contract** (`contracts/sharibo/src/lib.rs`). 🔒 **Hard prerequisite, not a nice-to-have**, alongside the circuit audit above. *Not yet filed.*
- [ ] **Reentrancy.** `claim` transfers the pot before zeroing it — a reentrancy window via a hostile token (#247). Regression test via a hostile token during `claim`: #317.
- [ ] **Input validation.** `create_circle` accepts `size = 0` and negative contributions with no validation (#248); a circle `size` larger than the circuit's Merkle tree capacity is not rejected (#249); regression test for the zero-size free-claim case: #316.
- [ ] **Storage archival — the nullifier double-claim fence.** Full analysis in [ADR 004](adr/004-storage-archival.md): a nullifier's TTL is extended once, never again, so an archived-and-unrestored nullifier can be replayed. Fix tracked in #254. Supporting work: document/justify the TTL constants as a single pair (#255), extract the repeated TTL-extension boilerplate (#236), add tests that advance the ledger past TTL expiry (#85).
- [ ] **Token trust assumptions.** `token` is an arbitrary caller-supplied address with no restriction — document what the contract implicitly trusts it to do (#262).
- [ ] **Invariant testing.** A `Circle` invariant-check test asserting pot accounting can never drift (#265).
- [ ] **Storage versioning.** Version the `Circle` storage struct before any redeploy, so a future migration doesn't silently misread old entries (#260).
- [ ] **Client SDK reliability.** `withRetry` is called five times in `contract.ts` but defined nowhere — the SDK is currently broken (#221). Validate proof and verification-key shapes client-side before submitting a claim, so malformed input fails before a transaction is even built (#288).

## 3. Operational

- [ ] **Observability.** Emit contract events from every state-changing entrypoint (#250) — a prerequisite for any monitoring at all; today there is nothing to alert on.
- [ ] **Monitoring/alerting** on the deployed mainnet contract(s) — dormant circles, unusual claim patterns, RPC health. *Not yet filed.*
- [ ] **Incident response plan** — who can act if a bug is found or a key is suspected compromised, and what "act" means given the contract has no upgrade path (see [ADR 001](adr/001-upgradeability.md): the answer today is "migrate," not "patch"). *Not yet filed.*
- [ ] **Key custody.** Decide and document how mainnet admin key(s) (and any future `fee_recipient`, see Product below) are held and rotated. Contract-level prerequisite: there is currently no way to rotate a circle's admin at all — add an `admin_transfer` entrypoint (#257). Per ADR 001, admin becomes load-bearing (and thus rotation becomes urgent) the moment any admin-gated operation — like fees — ships. *Operational custody plan itself: not yet filed.*
- [ ] **Dependency update cadence and lockfile policy** documented (#338) — supply-chain hygiene ahead of holding real funds.

## 4. Product

- [ ] **Enforced turn ordering.** [ADR 002](adr/002-multi-round-turn-ordering.md) (status: **Proposed**) documents that today the same identity can claim every round of a cycle back to back — nothing on-chain enforces "one claim per member per cycle." The design issue (#91) is closed; there is no open issue for actually implementing the enforcement it specifies. *Not yet filed.*
- [x] **Fees.** Shipped in [#252](https://github.com/crackedstudio/sharibo/issues/252): `apply_fee` wired into `claim`, `fee_bps`/`fee_recipient` added to `Circle` (immutable at creation) with the protocol-fee ADR ([003](adr/003-protocol-fees.md)), and a `fee_bps > 10_000` guard (`MAX_FEE_BASIS_POINTS` → `InvalidFeeParams`).
- [ ] **A way out of a stuck circle beyond admin-only cancel.** Add a round deadline so a stalled circle can be force-cancelled without depending on the admin key being available (#258). A fuller dispute-handling path (contested claims, partial rounds) beyond "cancel and refund" — *not yet filed.*

---

## Where this leaves the project

Every checkbox above is unchecked. Two of them are marked as **hard prerequisites** regardless of
everything else: a third-party audit of the circuit, and a third-party audit of the contract.
Until both of those and the multi-party ceremony are done, the question of mainnet readiness
doesn't come down to any individual open issue — it's not close. This document should be
re-read (and items checked off, or new ones added) as issues close, not left to go stale; see
[`docs/threat-model.md`](threat-model.md) for the property-level detail behind the cryptographic
and contract items above.
