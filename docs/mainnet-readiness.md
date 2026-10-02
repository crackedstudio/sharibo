# Mainnet readiness checklist

Sharibo is **testnet-only, no real funds** (see the banner in `app/src/App.tsx` and README
"Honest limitations"). This document lists what would have to be true before that changed. It is
a **checklist, not a timeline** — there are no target dates here, because any date would be
fiction. Every item links to the issue tracking it.

**How to read this:** This document should be re-read (and items checked off, or new ones added) as issues close, not left to go stale. The genuine blockers (audits and ceremony) lead the sections.

## 1. Cryptographic

- [ ] **Run a genuine multi-party trusted-setup ceremony.** Runbook: [docs/ceremony.md](ceremony.md). Tracking issue: **#546**. 🔒 **Hard prerequisite** — The deployed vk remains single-contributor until this completes.
- [ ] **Independent third-party audit of the ZK circuit** (`circuits/membership.template.circom`). 🔒 **Hard prerequisite, not a nice-to-have** — nothing below substitutes for this. Audit package prep: [docs/audit/](audit/README.md), tracking issue **#547**.
- [ ] **Bind the payout recipient to the proof.** Shipped in code (contract computes `recipientHash`, circuit includes it, partially addressing #246), but the threat model and six docs still describe it as future (#471).

## 2. Contract

- [ ] **Independent third-party audit of the Soroban contract** (`contracts/sharibo/src/lib.rs`). 🔒 **Hard prerequisite, not a nice-to-have**, alongside the circuit audit above. Tracking issue: **#548**.
- [ ] **Client SDK reliability.** `withRetry` shipped (fixes #221) but is untested (#462).

## 3. Operational

- [ ] **Monitoring/alerting** on the deployed mainnet contract(s) — dormant circles, unusual claim patterns, RPC health. Tracking issue: **#549**.
- [ ] **Incident response plan** — who can act if a bug is found or a key is suspected compromised, and what "act" means given the contract has no upgrade path. Tracking issue: **#550**.
- [ ] **Key custody.** Decide and document how mainnet admin key(s) are held and rotated. Tracking issue: **#551**.
- [ ] **Dependency update cadence and lockfile policy** documented (#338) — supply-chain hygiene ahead of holding real funds.

## 4. Product

- [ ] **Enforced turn ordering.** [ADR 002](adr/002-multi-round-turn-ordering.md) documents that today the same identity can claim every round. Enforcement implementation tracking issue: **#552**.
- [ ] **A way out of a stuck circle beyond admin-only cancel.** `expire_round` shipped (#258) but has no client SDK or UI surface (#485). A fuller dispute-handling path (contested claims, partial rounds) beyond "cancel and refund" — tracking issue: **#553**.

## Done

- [x] **Verification-key provenance and integrity.** Pin and document the provenance (#274); run `snarkjs zkey verify` (#271); verify circuit artifact integrity (#273).
- [x] **Wire-format invariants** documented in one place (#344).
- [x] **Mutation testing for the SDK's crypto module** (#327).
- [x] **Reentrancy.** `claim` transfers the pot before zeroing it (#247). Regression test (#317).
- [x] **Input validation.** size=0 (#248); larger than Merkle capacity (#249); regression test (#316).
- [x] **Storage archival — the nullifier double-claim fence.** (#254). Document TTL constants (#255), tests (#85).
- [x] **Token trust assumptions.** (#262).
- [x] **Invariant testing.** (#265).
- [x] **Storage versioning.** (#260).
- [x] **Validate proof and verification-key shapes client-side.** (#288).
- [x] **Observability.** Emit contract events (#250).
- [x] **Admin transfer entrypoint.** (#257).
- [x] **Fees.** (#252).
- [x] **Risk write-up for recipient binding.** (#339).

## Foundational work already done

These are closed issues / existing documents this checklist builds on:
- [`docs/threat-model.md`](threat-model.md) — the structured security-properties document (#23).
- [`docs/adr/001-upgradeability.md`](adr/001-upgradeability.md) — decision to stay immutable, admin rotation deferred (#92).
- [`docs/adr/002-multi-round-turn-ordering.md`](adr/002-multi-round-turn-ordering.md) — turn-ordering **design** (#91).
- [`docs/adr/004-storage-archival.md`](adr/004-storage-archival.md) — storage TTL/archival analysis (#340).
- A multi-party trusted-setup **ceremony plan** was documented (#74).

---

## Where this leaves the project

Two items are marked as **hard prerequisites** regardless of everything else: a third-party audit of the circuit, and a third-party audit of the contract.
Until both of those and the multi-party ceremony are done, the question of mainnet readiness doesn't come down to any individual open issue — it's not close. This document should be re-read (and items checked off, or new ones added) as issues close, not left to go stale.
