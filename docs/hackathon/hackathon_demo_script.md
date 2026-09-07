# Sharibo — demo script v2 (~2:20)

> [!NOTE]
> **Point-in-time archive:** This document is a historical record of the demo script written for the original hackathon submission. It is not maintained. For current project documentation and instructions, see [README.md](../../README.md).

**Why v2:** the hackathon asks for a 2–3 minute walkthrough. v1 was 60s — punchy, but it spent zero seconds on the project's strongest differentiator: _real_ on-chain Groth16 verification, with a from-the-trenches engineering story (the BN254 wall) and public tx hashes. v2 keeps v1's pacing for the first minute, then adds the two sections judges actually score on: "why this was hard" and "what we verified vs. what we're honest about."

**Tone:** same as v1 — fast, confident. Every claim below is backed by [`full_product_breakdown.md`](../../full_product_breakdown.md) §4/§6/§13. Nothing needs softening; it's all real.

---

## Shot-by-shot

| Time          | On screen                                                                                                           | Voiceover                                                                                                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0:00–0:04** | Landing. Name-wall chips visible. One beat of stillness.                                                            | _"Every culture on Earth runs a version of this."_                                                                                                                                                                                                                                                                                    |
| **0:04–0:10** | Pan across chips: ajo, tanda, susu, tontine, hui, chit fund…                                                        | _"Ajo. Tanda. Susu. Tontine. Hundreds of millions of people save in rotating circles — and every one runs on the same weak point: everyone knows exactly who's collecting the pot."_                                                                                                                                                  |
| **0:10–0:14** | Cut to Sharibo. Click **Launch a 5-member circle on testnet**.                                                      | _"Sharibo fixes that. On-chain. For real — and I mean cryptographically real, which I'll prove in a minute."_                                                                                                                                                                                                                         |
| **0:14–0:22** | Sped-up montage (2–3×): circle created → 5 funds → pot bar fills → ring nodes light.                                | _"Five members. Five real deposits on Stellar testnet — all public, all visible. That part isn't private, on purpose."_                                                                                                                                                                                                               |
| **0:22–0:26** | Select claimant → click **Generate proof & claim**. `Groth16 · BLS12-381 · 1,452 constraints` line holds on screen. | _"Now — who gets the pot? Watch."_                                                                                                                                                                                                                                                                                                    |
| **0:26–0:36** | Proving runs in REAL TIME (never speed this up). Then claim success → ring reveal → outside "?" node.               | _"That's not a spinner. That's a Groth16 proof being generated live in the browser — no server, no trusted party — and verified on-chain by a real BLS12-381 pairing check inside a Soroban contract."_                                                                                                                               |
| **0:36–0:42** | Ring caption / explorer: 5 deposits, 1 payout, fresh address. Overlay: `5 in → 1 out → 0 links`.                    | _"Five deposits in. One payout out — to a brand-new address that's never touched this circle. Nobody, including me, can tell you which member just got paid."_                                                                                                                                                                        |
| **0:42–0:50** | Click **Try to claim again**. Red rejection box, full-bleed. Overlay: `Error(Contract, #4): AlreadyClaimed`.        | _"Now watch someone try to cheat — replaying that exact proof. Rejected. On-chain. That's not a UI check — the contract's nullifier map refused it."_                                                                                                                                                                                 |
| **0:50–1:00** | Terminal or slide: tampered-proof rejection — `Error(Contract, #5): InvalidProof`.                                  | _"And a tampered proof? Also rejected — the pairing equation itself fails. Both rejections are reproducible from the repo."_                                                                                                                                                                                                          |
| —             | **SECTION: WHY THIS WAS HARD**                                                                                      |                                                                                                                                                                                                                                                                                                                                       |
| **1:00–1:12** | Simple graphic or code view. Overlay: `BN254 pairing ≈ 560,000,000 instructions` vs `Soroban budget: 100,000,000`.  | _"Here's the part that separates this from a tutorial. The standard Circom stack uses the BN254 curve. We measured it: one BN254 pairing on Soroban costs about 560 million instructions — against a hard 100-million cap. Not expensive. Impossible."_                                                                               |
| **1:12–1:24** | Show the verifier code (`pairing_check` lines) or contract snippet. Overlay: `claim(): 48.0M / 100M CPU (~48%)`.    | _"So Sharibo runs the entire pipeline — circuit, trusted setup, contract — on BLS12-381, the one curve Stellar accelerates natively. A real claim, with a real proof, costs 48 million instructions. Comfortably inside budget. Measured, not estimated."_                                                                            |
| **1:24–1:36** | Show the Poseidon note briefly (one line), then cut to the tx-hash table from the README.                           | _"That meant sourcing Poseidon constants generated for the right field — cross-checked against Soroban's own modulus — and matching byte layouts across circuit, contract, and client. The accepted proof, the rejected proof, the full round: every one is a public testnet transaction. The hashes are in the README. Check them."_ |
| —             | **SECTION: PROOF & HONESTY**                                                                                        |                                                                                                                                                                                                                                                                                                                                       |
| **1:36–1:48** | Fast cut: circuit tests 5/5 green → contract tests 8/8 green → e2e output tail.                                     | _"Five circuit tests. Eight contract tests — including the pairing check failing for a forged input, and a CPU-budget assertion. One end-to-end script that runs the whole round against live testnet, then replays the nullifier and proves it gets rejected."_                                                                      |
| **1:48–2:00** | Plain card: **"Honest scope: claim-side privacy. One round. Testnet."**                                             | _"And the honest scope, stated plainly: privacy covers who claims, not who funds. One round is demoed, not a full rotation. It's testnet, with a single-party trusted setup. Every limitation is documented — nothing is silently faked."_                                                                                            |
| **2:00–2:12** | Back to name-wall / logo.                                                                                           | _"Ajo, tanda, susu, tontine — this is how a huge share of the world already saves. Stellar is where real-world money already moves. Sharibo makes the trust those circles run on cryptographic instead of social."_                                                                                                                   |
| **2:12–2:20** | Final card: **SHARIBO** + _"Real ZK. Real chain. Real privacy."_ + repo URL + contract ID.                          | _"Sharibo. Real ZK, verified on a real chain — for a problem that's already real. The repo has everything: code, tests, transaction hashes. See for yourself."_                                                                                                                                                                       |

---

## Clean VO-only script

> Every culture on Earth runs a version of this. Ajo. Tanda. Susu. Tontine. Hundreds of millions of people save in rotating circles — and every one runs on the same weak point: everyone knows exactly who's collecting the pot.
>
> Sharibo fixes that. On-chain. For real — and I mean cryptographically real, which I'll prove in a minute.
>
> Five members. Five real deposits on Stellar testnet — all public, all visible. That part isn't private, on purpose.
>
> Now — who gets the pot? Watch.
>
> That's not a spinner. That's a Groth16 proof being generated live in the browser — no server, no trusted party — and verified on-chain by a real BLS12-381 pairing check inside a Soroban contract.
>
> Five deposits in. One payout out — to a brand-new address that's never touched this circle. Nobody, including me, can tell you which member just got paid.
>
> Now watch someone try to cheat — replaying that exact proof. Rejected. On-chain. That's not a UI check — the contract's nullifier map refused it. And a tampered proof? Also rejected — the pairing equation itself fails. Both rejections are reproducible from the repo.
>
> Here's the part that separates this from a tutorial. The standard Circom stack uses the BN254 curve. We measured it: one BN254 pairing on Soroban costs about 560 million instructions — against a hard 100-million cap. Not expensive. Impossible.
>
> So Sharibo runs the entire pipeline — circuit, trusted setup, contract — on BLS12-381, the one curve Stellar accelerates natively. A real claim, with a real proof, costs 48 million instructions. Comfortably inside budget. Measured, not estimated.
>
> That meant sourcing Poseidon constants generated for the right field — cross-checked against Soroban's own modulus — and matching byte layouts across circuit, contract, and client. The accepted proof, the rejected proof, the full round: every one is a public testnet transaction. The hashes are in the README. Check them.
>
> Five circuit tests. Eight contract tests — including the pairing check failing for a forged input, and a CPU-budget assertion. One end-to-end script that runs the whole round against live testnet, then replays the nullifier and proves it gets rejected.
>
> And the honest scope, stated plainly: privacy covers who claims, not who funds. One round is demoed, not a full rotation. It's testnet, with a single-party trusted setup. Every limitation is documented — nothing is silently faked.
>
> Ajo, tanda, susu, tontine — this is how a huge share of the world already saves. Stellar is where real-world money already moves. Sharibo makes the trust those circles run on cryptographic instead of social.
>
> Sharibo. Real ZK, verified on a real chain — for a problem that's already real. The repo has everything: code, tests, transaction hashes. See for yourself.

---

## Overlays (do these — they carry credibility silently)

- **0:22** — `Groth16 · BLS12-381 · 1,452 constraints`
- **0:36** — `5 in → 1 out → 0 links`
- **0:42** — `Error(Contract, #4): AlreadyClaimed`
- **0:50** — `Error(Contract, #5): InvalidProof`
- **1:00** — `BN254 pairing: ~560M instr · budget: 100M`
- **1:12** — `real claim(): 48.0M / 100M CPU`
- **1:24** — `tx: 2258…8087 · ledger 3379702`
- **2:12** — repo URL + `CB64IZIB…2LCF`

## Recording checklist (unchanged items from v1 still apply)

- [ ] **FIRST: full click-through in a real browser.** Still the only unverified layer. If the ring/stepper/proving flow breaks, fix before recording anything.
- [ ] Pre-warm testnet off-camera (first RPC calls are the slow ones).
- [ ] Capture the tests-passing footage (`npm test` in circuits/, `cargo test`, tail of `npm run e2e`) — three short terminal clips, 3–4s each.
- [ ] Never speed up the proving wait; speed up the funding montage instead.
- [ ] If cutting for time: trim the funding montage and §"Proof & honesty" test clips first. Never cut the proving moment, the two rejections, or the BN254→BLS12-381 story.
