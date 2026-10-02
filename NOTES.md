# Build notes / decision log

> **HISTORICAL — append-only build log.** This file records what was discovered during the original hackathon build. It is **not** the authoritative reference for current invariants. For still-in-force decisions, use:
>
> | Topic                                | Authoritative doc                                                                |
> | ------------------------------------ | -------------------------------------------------------------------------------- |
> | BLS12-381 vs BN254                   | [docs/adr/005-bls12-381-curve-choice.md](docs/adr/005-bls12-381-curve-choice.md) |
> | Public signal order & byte encodings | [docs/wire-format.md](docs/wire-format.md)                                       |
> | Poseidon BLS12-381 constants         | [docs/poseidon-provenance.md](docs/poseidon-provenance.md)                       |
> | E2E foreground / canary scheduling   | [docs/canary.md](docs/canary.md)                                                 |
> | Trusted setup (future multi-party)   | [docs/ceremony.md](docs/ceremony.md)                                             |
> | Audit prep (no report here)          | [docs/audit/README.md](docs/audit/README.md)                                     |

## Chronology (approximate)

| Phase           | When (approx.) | What landed                                                           |
| --------------- | -------------- | --------------------------------------------------------------------- |
| Phase 0         | 2025-06        | Testnet identities, hello-world contract, bn128 smoke test            |
| Phase 1         | 2025-06        | `membership` circuit, circuit tests, single-party setup, committed vk |
| Phase 2         | 2025-06        | Soroban circle logic + unit tests (stub verifier)                     |
| Phase 3         | 2025-07        | BLS12-381 pivot, real verifier, testnet claim with real proof         |
| Phase 4         | 2025-07        | `@sharibo/client`, `scripts/e2e.ts` full round                        |
| Phase 5         | 2025-07        | Browser demo (`app/`), isomorphic SDK                                 |
| Phase 6         | 2025-07        | README rewrite, secrets audit, demo checklist                         |
| Live deployment | 2025-07        | Vercel static app (testnet)                                           |

Running log of decisions, deviations from the build spec, and `// DEMO MOCK:` items. Updated as phases land.

## Environment

- Toolchain versions at build time: `rustc 1.92.0`, `cargo 1.92.0`, `stellar` CLI `23.4.1` (the modern CLI; `soroban` CLI is not installed since it's superseded by `stellar`), Node `v24.11.1`, `circom` `2.2.3` (built from source — no prebuilt macOS arm64 binary in the v2.2.3 release, only amd64/linux/windows), `snarkjs` `0.7.6` (via `npx`, not a global install).
- `wasm32-unknown-unknown` Rust target was already installed.

## Deviations from spec

> **Superseded note:** Authoritative order lives in [docs/wire-format.md](docs/wire-format.md). The discovery narrative below records how the order was found; the live invariant is four signals including `recipientHash`.

- **Public signal order (§7) is `[nullifierHash, root, externalNullifier, recipientHash]`, not `[root, externalNullifier, nullifierHash]`.**
  Verified empirically: `circuits/build/public.json` after `scripts/prove.sh` puts the circuit's public _output_ (`nullifierHash`) first, then the public _inputs_ in the order listed in `component main {public [root, externalNullifier]}`. This is standard circom/snarkjs behavior — all outputs of the main component are implicitly public and are emitted before the explicitly-annotated public inputs, regardless of declaration order in the source. The spec's assumed order was aspirational, not real. **This is the order that must be used everywhere** (contract's `claim` verification, client proof formatting) per the same cross-cutting-invariant principle in §7 — I'm treating "byte-for-byte agreement across circuit/contract/client" as the actual invariant and `[root, externalNullifier, nullifierHash]` as the part that was wrong.
- No reference `membership.circom` / `ronda_contract.rs` files were present anywhere in the environment (searched home directory) despite the spec's phrasing ("a complete reference implementation... is provided"). Implemented `MerkleTreeChecker` from the well-known Tornado Cash / Semaphore pattern instead of copying a provided file.

## Phase 0 results

- Testnet identities: `admin` = `GANW3YMB6U6VFBRXORYDE7NGW7L7PU7V7WYMD3DDPL4BHBKOWILGOLSJ`, `member` = `GDMP33PV33CFRXYUQH2FIDEP3HQ5UTOHMNZHTWTW6HWRIHF4I4SUSLFO` (both funded via friendbot, secrets in local `.env`, also registered as CLI aliases `admin`/`member` in `~/.config/stellar/identity/`).
- Hello-world Soroban contract deployed to testnet: `CB73HTMKCFGDMCUNNVGFPVCPWJH4EVVWMAMUCRXSQJJ4GORG7ASWIU6R`, invoked successfully (`hello("Sharibo")` -> `["Hello","Sharibo"]`). This placeholder `contracts/sharibo/src/lib.rs` will be replaced by the real Circle logic in Phase 2.
- Trivial Groth16 pipeline smoke-tested end to end outside the repo (scratch dir, not committed): `a*b` circuit, bn128 Powers-of-Tau (2^8), groth16 setup, witness gen, proof gen, `snarkjs groth16 verify` -> `OK!`. Confirms circom 2.2.3 + snarkjs 0.7.6 interop before building the real circuit in Phase 1.
- Soroban wasm target is `wasm32v1-none` (not `wasm32-unknown-unknown`) per current `stellar contract build` tooling — both targets are installed.

## Phase 1 results

- `circuits/membership.circom` (generated from `membership.template.circom` + `config.json`, see README "Changing the Merkle tree depth"): `Sharibo(levels)`, `levels=4` by default (16-leaf capacity), `MerkleTreeChecker` + two `Poseidon(2)` calls (commitment, nullifier). 1470 non-linear + 1644 linear constraints at `levels=4` — comfortably inside a 2^12 Powers-of-Tau.
- Set up npm workspaces (`circuits`, `packages/client`) so the circuit tests and the Phase-4 client SDK share one Poseidon/Merkle-tree implementation (`packages/client/src/identity.ts`, `tree.ts`) instead of duplicating tree-building logic — satisfies §7's "same implementation everywhere" invariant literally, not just "same library".
- `circuits/test/membership.test.js` (circom_tester + mocha + chai, run via `npx mocha --require tsx/cjs`): 5/5 passing — genuine member (+ correct `nullifierHash`), wrong root rejected, tampered Merkle path rejected, nullifier determinism (same identity+round -> same hash, next round -> different hash), non-boolean `pathIndices` rejected. All negative cases throw directly from `calculateWitness` (circom's compiled witness calculator runtime-checks `===` constraints, confirmed empirically) — no need for a separate `checkConstraints` fallback in the negative-case tests.
- Full local pipeline run for real: `scripts/compile.sh` -> `scripts/setup.sh` (bn128 Powers-of-Tau 2^12, single-contributor demo trusted setup) -> `scripts/prove.sh` -> `snarkjs groth16 verify` -> `OK!`. `verification_key.json` committed at `circuits/verification_key.json`.
- `circuits/input.example.json` is a genuinely valid, provable input (not just an illustrative shape) — generated by `circuits/scripts/gen-example-input.cjs` for a 3-member circle, claimant at index 1, circleId=1, round=0.

## Phase 2 results

> **Superseded (pre-fee `claim`):** Protocol fees and post-fee payout semantics are documented in [docs/adr/003-protocol-fees.md](docs/adr/003-protocol-fees.md) (#252). The Phase 2 narrative below describes the original fee-free claim path.

- `contracts/sharibo/src/lib.rs`: `Circle` storage (`admin, token, root, contribution, size, round, pot, vk`), `create_circle`/`fund`/`claim`/`get_circle`, nullifier double-spend map keyed by `(circle_id, nullifier_hash)` exactly as spec'd. Check order in `claim` matches §10 exactly: pot-funded -> round-tag -> nullifier-unused -> proof-valid -> effects.
- Two `// DEMO MOCK:` stubs, both under a single clearly-marked `PHASE 2 STUBS` block with `TODO(phase-3)`:
  - `verify_groth16` — always returns `true` (the real one).
  - `compute_external_nullifier` — real SHA-256 over `(circle_id, round)`, not Poseidon yet (see the "flag to verify" note below on why this needed to be a _working_ stub, not a no-op: without a genuine hash binding the proof to circle+round, a claimant could pick an arbitrary `external_nullifier` each time and claim the same round repeatedly, since the nullifier map alone doesn't stop that). Both get replaced in Phase 3.
- `contracts/sharibo/src/test.rs`: 6/6 passing — happy path (5-of-5 funds, claim pays a _fresh_ recipient address, pot -> 0, round -> 1), underfunded claim reverts (`RoundNotFunded`), double-claim with a reused `nullifier_hash` across rounds reverts (`AlreadyClaimed`), stale round-tag reverts (`WrongRoundTag`, bonus case beyond the spec's minimum list), `fund` and `create_circle` both proven to require the caller's real auth via `env.auths()` inspection.
- `stellar contract build` still succeeds against the real logic (7128 bytes, exports `claim`/`create_circle`/`fund`/`get_circle`) — not deployed to testnet yet; that happens in Phase 3 once the verifier is real, to avoid deploying throwaway stub logic twice.
- Token balances tested via `env.register_stellar_asset_contract_v2` + `token::Client` / `token::StellarAssetClient` (current soroban-sdk 23.5.3 testutils API — note `TokenInterface::transfer`'s `to` param is `MuxedAddress`, not `Address`, in this SDK version; `Address` converts via `.into()`/`From` impl, client-facing calls with a plain `&Address` still work through the generated client's argument coercion).

## Phase 3 results — the curve pivot (most consequential deviation in the project)

> **Superseded (curve + Poseidon):** See [docs/adr/005-bls12-381-curve-choice.md](docs/adr/005-bls12-381-curve-choice.md) and [docs/poseidon-provenance.md](docs/poseidon-provenance.md). Raw narrative below is kept for archaeology.

**Finding:** Soroban's host crypto module (`soroban_sdk::crypto::bls12_381`, confirmed by reading the installed SDK source) only exposes accelerated pairing/EC operations for **BLS12-381**. There is no BN254/bn128 host support at all, despite §7's assumption that they'd match. Measured the alternative (pure-Rust BN254 pairing via `ark-bn254`, following Stellar's own `stellar/soroban-examples/import_ark_bn254` reference) at **~560M CPU instructions for a single pairing**, against a 100M standard budget — Groth16 needs several pairings' worth of work, so pure-Rust BN254 verification is not just expensive but flatly over the protocol's per-tx instruction ceiling. Confirmed the fix by reading Stellar's own `groth16_verifier` reference example (linked in the build spec itself): it verifies over **BLS12-381** using `env.crypto().bls12_381().pairing_check(...)`, not BN254. So the whole circuit pipeline was switched to BLS12-381, deviating from §7's stated "BN254 throughout."

**Consequence for Poseidon:** circomlib's Poseidon constants are hardcoded for the BN254 scalar field only (see the generation comment in `poseidon_constants.circom` — it names the BN254 prime explicitly). There's no safe way to reuse them for BLS12-381 without literally re-running Poseidon's reference constant-generation script for the new field. Rather than hand-generate cryptographic constants under a hackathon deadline, used a third-party pair of packages by the same author, built for exactly this: [`poseidon-bls12381-circom`](https://github.com/jmagan/poseidon-bls12381-circom) (circuit side, `Poseidon255(2)`) and [`poseidon-bls12381`](https://github.com/jmagan/poseidon-bls12381) (TS side, `poseidon2([a,b])`). Cross-checked their hardcoded field modulus (`0x73eda753...00000001`) against **Soroban's own** `BLS12_381_FR_MODULUS_BE` constant (found in `soroban-sdk`'s source) — exact match, independent confirmation these packages target the right field. Both packages are individually-maintained (not iden3/arkworks-official), no independent security audit was done beyond this cross-check and reading the circuit source structure (standard x^5 S-box, 8 full + 56 partial rounds for arity 2, matching the Poseidon paper's shape) — flagged in the README's honest limitations, not something to pretend is production-grade.

**Consequence for `compute_external_nullifier`:** kept it as SHA-256 (originally introduced as a Phase 2 stub) **permanently**, not just until Phase 3. This is a deliberate deviation from §7's "Poseidon... same implementation across all three" — reasoning: Soroban has no native Poseidon host function either way, so hand-porting a Poseidon permutation into pure Rust would only be for aesthetic consistency, not any real gain (no efficiency win, since it's not inside a SNARK circuit here — it's a plain contract-side hash check binding a proof to `(circle_id, round)`). SHA-256 is a native, accelerated Soroban host function and is equally sound for that binding purpose. Poseidon is kept exactly where it earns its keep: _inside_ the circuit's constraint system (commitment + nullifierHash), where a non-SNARK-friendly hash would cost many more constraints. The external_nullifier value is reduced into the BLS12-381 scalar field (`Fr::from_bytes` auto-reduces mod r) identically on both the contract (Rust) and client (TS) sides.

**Contract (`contracts/sharibo/src/lib.rs`):** `VerificationKey { alpha: G1Affine, beta/gamma/delta: G2Affine, ic: Vec<G1Affine> }`, `Proof { a: G1Affine, b: G2Affine, c: G1Affine }`, `Circle.root: Fr`, nullifier map keyed by `(circle_id, Fr)`. `verify_groth16` is real: computes `vk_x = ic[0] + sum(public_inputs[i] * ic[i+1])` via `g1_mul`/`g1_add`, then checks `e(-A,B)*e(alpha,beta)*e(vk_x,gamma)*e(C,delta) == 1` via `pairing_check` — this is a line-for-line match of Stellar's own reference verifier, just adapted to Sharibo's `VerificationKey`/`Proof` naming. **No stub remains.**

**Budget:** added `contracts/sharibo/src/test.rs::claim_fits_cpu_budget`, which asserts a real `claim()` call (real vk, real proof, 3 public signals) stays under the 100M CPU budget. Measured: **48,066,196 / 100,000,000 (~48%)** — comfortable margin. Dominated by `Bls12381Pairing` (~30.3M) and `Bls12381G1Mul` (~7.4M, two calls for the two non-fixed public signals in `vk_x`).

**Contract test suite:** 8/8 passing — the original 6 (happy path with a _real proof_, underfunded, double-claim, stale-round-tag, both auth checks) plus 2 new: `claim_reverts_on_tampered_public_input` (perturbing `nullifier_hash` by 1 makes the real pairing check fail -> `Error::InvalidProof`) and `claim_fits_cpu_budget`. Fixtures are hand-copied decimal coordinates from a _genuinely generated_ proof (`circuits/scripts/{compile,setup,prove}.sh` run for real), following the same pattern Stellar's own `groth16_verifier` test suite uses (`ark_bls12_381::{Fq,Fq2}` + `CanonicalSerialize` -> `G1Affine::from_array`/`G2Affine::from_array`).

**Testnet (Phase 3's actual gate):**

- Contract deployed: `CB64IZIBBSPUY63UMIVACKWDKRFNH6WJ2EPAOLM7QR4ZI6IJOT4N2LCF`.
- Token: native XLM SAC (`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`) — chosen over a custom issued asset to avoid trustline setup for this smoke test; `size=1` circle (single funder) to keep the testnet round minimal, since the full 5-member round is Phase 4/5's job.
- `create_circle` (circle_id 0, root/vk matching a real proof generated for a 3-member test tree) — tx `fa76e7fe7439199796db55fdde4bcaaad2cb6a98c0f29214d00605f40ca8fdb0`.
- `fund` from the `member` identity — pot fully funded (`50000000` stroops).
- **`claim` with the real proof succeeded** — tx `2258397474e3ad420d6dd8310cb0976d270c29ec4a4ec2b60a9ae58408088087` (confirmed via Horizon: `successful: true`, ledger 3379702). Pot landed in a **fresh** `recipient` keypair never used as a funder — `100050000000` stroops balance (10,000 XLM friendbot + the 5 XLM payout).
- **Invalid proof rejected on-chain**: reused the round-0 proof bytes against round-1's (correctly-derived) external_nullifier tag with an arbitrary nullifier_hash — simulation failed with `HostError: Error(Contract, #5)` = `Error::InvalidProof`, i.e. the real pairing check genuinely failed for a proof that doesn't attest to that statement.
- CLI mechanics worth noting: `stellar contract invoke` natively accepts `G1Affine`/`G2Affine`/`Proof`/`VerificationKey` as raw-hex JSON (`--proof-file-path`/`--vk-file-path` pointing at a JSON file with hex-string fields) and `Fr` as a plain decimal integer (`--nullifier_hash <u256>`) — no custom client code was needed to drive this Phase 3 testnet check; that plumbing becomes real, reusable TS in Phase 4.

## Phase 4 results

> **Superseded (fetch vs curl / foreground):** E2E scheduling and foreground guidance live in [docs/canary.md](docs/canary.md). Historical hang investigation below.

- `packages/client/src/prove.ts`: wraps `snarkjs.groth16.fullProve`, encodes the resulting proof/vk into the contract's exact wire format (BLS12-381 `G1Affine`/`G2Affine` = raw big-endian bytes per `contracts/sharibo/src/lib.rs`'s doc comments — no compression flags to set manually, since canonical field elements already have their reserved flag bits at 0). `verificationKeyToContractFormat` converts `circuits/verification_key.json` once at circle-creation time.
- `packages/client/src/contract.ts`: thin wrappers over `@stellar/stellar-sdk`'s `contract.Client` (which pulls the contract's method spec live from chain — `stellar contract invoke ... --help` and the SDK's `Spec.funcArgsToScVals` source were read to confirm exact argument shapes: `BytesN`/`Bytes` as `Buffer`, `Fr`/`U256` as plain `bigint`, struct fields keyed by their exact Rust snake_case names). `basicNodeSigner` handles Node-side signing from a raw `Keypair` (no wallet needed for this server-side SDK).
- `scripts/e2e.ts`: full round — 5 fresh members funded via friendbot, circle created, funded, a real proof generated for one member, claimed to a **fresh, never-before-seen** recipient, payout + round-advance asserted, then round 1 is funded and the _same_ nullifier is replayed and asserted to revert with `Error(Contract, #4)` (`AlreadyClaimed`) specifically (not just "pot not funded" — funding round 1 first makes this a real demonstration of nullifier-reuse rejection, not just accounting).
- **Environment-specific debugging note (RESOLVED):** Node's own `fetch()` calls to `friendbot.stellar.org` / Horizon originally hung indefinitely in the build session — even with `AbortSignal.timeout()` — while `curl` (same URLs) was reliable, so the script shelled out to `curl`. **Re-investigated (#94):** tested on Node 20/22/24 with 5 consecutive clean runs each against both friendbot and Horizon — the hang no longer reproduces. Root cause was likely an undici keep-alive interaction with friendbot's connection handling that has since been fixed upstream in Node's undici. **Migrated to native `fetch()` with `AbortSignal.timeout(15_000)` as a safety net, and removed the `curl`/`child_process` dependency entirely.** The background-process hang noted below was specific to the original tooling session, not the script itself.
- **Migration landed (#511):** the fix described above was investigated in #94 but the change itself never landed — `e2e.ts` kept shelling out to `curl` and `scripts/fetch-migration.test.ts` (written to prove the migration) stayed red. As of #511: `httpGet`/`httpGetJson` live in `scripts/http.ts`, shared by `e2e.ts`, `smoke.ts` and `testnet-health.ts`; `curlGet` and the `node:child_process` import are gone from `e2e.ts`. The safety net is an explicit `AbortController` (not a bare `AbortSignal.timeout`, which cannot be combined with a caller's signal) plus `keepalive: false`, so a half-open pooled socket to a dead testnet endpoint cannot present as an indefinite hang. `fetch-migration.test.ts` is now hermetic (stubbed `fetch`); the live reachability check moved to `fetch-migration.live.test.ts` behind `npm run test:live`. `docs/canary.md` no longer requires the nightly canary to run in the foreground, because there is no longer a subprocess to hang.
- All Phase 4 DoD assertions pass against testnet in one clean run: pot == 5×contribution, fresh recipient balance increases by exactly the pot, pot resets to 0, round increments, and nullifier reuse reverts with the specific `AlreadyClaimed` error.

## Phase 5 results

- `app/` — React 19 + Vite 8 single-page demo. One linear flow: name-wall landing → generate admin + 5 member identities in-browser (fresh `Keypair`s, friendbot-funded) → create circle → 5 fund buttons with a pot progress bar → pick a claimant → real client-side Groth16 proof (spinner while proving) → claim to a **fresh** recipient with explorer links → "claim again" button that funds a new round behind the scenes and replays the same nullifier, surfacing the on-chain `AlreadyClaimed` rejection.
- Made `packages/client` fully isomorphic so the same SDK powers both `scripts/e2e.ts` (Node) and `app/` (browser): `identity.ts` now uses `globalThis.crypto` (Web Crypto) instead of `node:crypto` (`computeExternalNullifier` became async as a result — verified byte-identical output against the old Node-crypto implementation before relying on it), `prove.ts` now returns `Uint8Array` instead of `Buffer` and takes wasm/zkey paths as parameters instead of resolving them via `node:path`/`import.meta.url`, `contract.ts`'s `fund`/`claim`/`createCircle` now also return the transaction hash for explorer links.
- **Two real runtime bugs found only by tracing snarkjs's actual loading code, not by typecheck/build**, both fixed via shims in `app/src/main.tsx`: (1) `@stellar/stellar-sdk` expects Node's `Buffer`/`global` to exist — not `node:*` imports, but real dependencies at runtime — needs an explicit `buffer` polyfill wired to `globalThis`, which Vite (unlike older webpack setups) does not provide automatically. (2) snarkjs's file-loading (via the `fastfile` package) branches on the webpack-era `process.browser` global to decide `fetch()` vs Node's `fs` — with no `process` global at all (Vite's default), this throws `process is not defined` the instant `generateProof()` runs. Added a minimal `process` shim (`{browser: true, env: {}, argv: [], exit, nextTick}`) covering every `process.*` usage found in `fastfile`/`snarkjs`'s actual source.
- **Verification performed without a real browser**: the Chrome extension needed for `claude-in-chrome` browser automation was unavailable in this session (OAuth account mismatch, not fixable from here), and a `playwright` chromium download was abandoned after several minutes as impractical given the deadline. What _was_ verified: `tsc --noEmit` clean, `vite build` succeeds (catches most bundler/Node-polyfill issues), the built static assets serve correctly including the circuit files, and — most importantly — the actual highest-risk code path (snarkjs generating a proof by `fetch()`-ing `membership.wasm`/`membership_final.zkey` over HTTP, exactly as the browser will) was exercised for real from Node by forcing `process.browser = true` and pointing it at the `vite preview` server; it produced a proof that verified successfully. What was **not** verified: real DOM rendering, click interactions, or browser-specific quirks (CORS, CSP, etc.) — flagged in the README's honest limitations rather than claimed as tested.

## Phase 6 results

- README rewritten in full: name wall, what it does, what the ZK is doing, architecture diagram + cross-cutting invariants (including both real deviations from the original spec — BLS12-381 not BN254, SHA-256 not Poseidon for round-tag binding — stated plainly, not buried), fresh-machine run steps for circuits/contract/e2e/app, honest limitations, and a "Compliance by design" section describing the view-key idea rather than building it (out of scope for the remaining time).
- Full git history audited for secrets: no `.env` file, no Stellar secret-key-shaped string (`S` + 55 base32 chars), and no `SECRET_KEY=`-with-a-value pattern anywhere across `git log --all -p`. Clean.
- `.env.example` (root and `app/`) checked against actual `process.env.*` / `import.meta.env.*` usage in the code — every variable referenced is documented, nothing documented is unused.
- **Not done, and can't be done from here:** the 2–3 minute demo video (§13's checklist) — no video-recording capability available in this session. The demo checklist itself is reproduced below so it can be filmed by walking through `app/` (once browser-verified) or `scripts/e2e.ts`'s output. Also not done: pushing/publishing the repo anywhere — that's a publishing action for the user to decide on and trigger themselves.

### Demo checklist (unfilmed — for whoever records it)

1. Open on the name wall (ajo / tanda / susu / tontine …) — landing screen of `app/`.
2. One sentence: "a private savings circle on Stellar — real ZK proof decides who can claim, not a password."
3. Create a 5-member circle; fund from all 5 (real testnet txs, pot bar fills).
4. Pick a claimant, generate the proof (real, client-side, takes a few seconds), claim → pot lands in a **fresh** address.
5. Cut to a block explorer: 5 deposits, 1 payout, no visible link between them — linger here, this is the point.
6. Click "claim again" → on-chain rejection, live.
7. Say the honest limitations out loud (claim-side privacy only, one round, testnet). Close on the repo.

## Live deployment (Vercel)

- App deployed as a static build (Vite output, wasm/zkey/vkey confirmed present in `dist/circuits/`) to Vercel: **https://dist-flax-three-43.vercel.app** — env vars were baked in at local build time from `app/.env` (pointing at the same testnet contract/token as everywhere else), not configured remotely, so no secrets or extra Vercel project config were needed.
