# Refactor and hardening backlog — reading order

A dependency-ordered map of issues #455–#579, filed 2026-09-25 after a full audit of
the repository. It exists because 125 issues in a flat list is not a plan: several of
them are blocked on each other, and roughly a third are the _same_ defect in different
files.

Use it as a queue. Everything in **Wave 0** blocks everything else.

> **How this list was produced.** Every claim in these issues was verified by running
> the command in the issue body against a clean clone at `d0bd83f`, not inferred from
> reading code. Where an issue says a suite fails, the failure output is quoted.

---

## The finding behind a third of the backlog

`main` does not build, and has not for some time:

| Gate                          | Result on a clean clone                                                  |
| ----------------------------- | ------------------------------------------------------------------------ |
| `cargo build`                 | **fails** — `MAX_CIRCLE_SIZE` referenced at `lib.rs:374`, never declared |
| `cargo test`                  | **fails to compile** — 7 errors; no contract test has run                |
| `npm run lint`                | **crashes** — flat-config object declares a rule without its plugin      |
| `npm run lint:dead`           | 6 unused files, 3 unused deps, 6 unlisted deps, 16 unused exports        |
| `npm test -w packages/client` | 14 failed / 106                                                          |
| `npm test -w packages/core`   | 2 failed / 71                                                            |
| `npm test -w app`             | 30 failed / 94                                                           |
| `npm test -w scripts`         | 28 failed / 47                                                           |
| `just verify`                 | runs a shadowed two-line recipe, not the documented 45-line gate         |

`CONTRIBUTING.md` states the policy this is the result of — _"This repo has no CI, so
human review is the gate"_ — and `docs/canary.md` restates it as deliberate. The
failures above are all merge-resolution losses and stale fixtures: the class of defect
human review is worst at catching and a five-minute workflow catches every time.

A second pattern accounts for most of the rest. **An issue was closed by creating the
new thing without migrating the caller**, leaving two copies:

| Closed issue     | What was created                                                   | What still runs                                                  |
| ---------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| #233             | `packages/core` (crypto primitives)                                | `packages/client`'s byte-identical copies — nothing imports core |
| #101             | `app/src/components/{Landing,ClaimSection,ResultCard,Stepper}.tsx` | `App.tsx`'s own inline copies                                    |
| #305             | a `viewBox`-scaling `MemberRing`                                   | `App.tsx`'s div-and-resize-listener version                      |
| #312             | per-member claim eligibility                                       | only in the unrendered component                                 |
| #287             | an explicit-export SDK barrel                                      | `export *`, with five lines duplicated                           |
| #228             | `app/src/lib/session.ts`                                           | file never created; `App.tsx` calls `sessionStorage`             |
| #229, #234, #235 | module splits                                                      | the 587-, 1215- and 1788-line originals                          |

---

## Wave 0 — unblock the repo (blocks everything)

Nothing else can be verified until these land. Roughly two days of work.

| #                                                           | Issue                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| [#455](https://github.com/crackedstudio/sharibo/issues/455) | Contract does not compile — `MAX_CIRCLE_SIZE` undeclared                |
| [#456](https://github.com/crackedstudio/sharibo/issues/456) | Contract tests do not compile — `create_circle` called with 7 of 9 args |
| [#457](https://github.com/crackedstudio/sharibo/issues/457) | `npm run lint` crashes; flat-config `ignores` are also not global       |
| [#458](https://github.com/crackedstudio/sharibo/issues/458) | `@sharibo/client` never built → ~35 of 44 app+scripts failures          |
| [#459](https://github.com/crackedstudio/sharibo/issues/459) | `justfile` defines `verify` twice; the stub wins                        |
| [#460](https://github.com/crackedstudio/sharibo/issues/460) | `just verify` uses `ts-prune` and a removed ESLint flag via `npx -y`    |
| [#461](https://github.com/crackedstudio/sharibo/issues/461) | **Add CI** — the "no CI" policy has demonstrably failed                 |
| [#572](https://github.com/crackedstudio/sharibo/issues/572) | `just ci` as the single gate definition, called by the workflow         |

## Wave 1 — red tests and stale guards

Each of these is a guard that exists, has been red for many merges, and therefore
protects nothing.

| #                                                           | Issue                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| [#462](https://github.com/crackedstudio/sharibo/issues/462) | `retry.test.ts` is a 6-line stub — `withRetry` has zero coverage         |
| [#463](https://github.com/crackedstudio/sharibo/issues/463) | `api-surface.json` ~50 exports stale; the refresh procedure doesn't work |
| [#464](https://github.com/crackedstudio/sharibo/issues/464) | SDK barrel has five duplicated `export *` lines                          |
| [#465](https://github.com/crackedstudio/sharibo/issues/465) | `app/vitest.config.ts` reads coverage thresholds from outside the repo   |
| [#466](https://github.com/crackedstudio/sharibo/issues/466) | `coverage-thresholds.json` is all zeros                                  |
| [#490](https://github.com/crackedstudio/sharibo/issues/490) | `artifacts.test.ts` calls a removed `__resetForTesting` — 6 tests fail   |
| [#491](https://github.com/crackedstudio/sharibo/issues/491) | `xlmToStroops` rounds up; its test asserts truncation                    |
| [#492](https://github.com/crackedstudio/sharibo/issues/492) | Two `formatXlm` tests assert arithmetically impossible values            |
| [#502](https://github.com/crackedstudio/sharibo/issues/502) | Secret-leak fixture is 55 chars, so the redaction guard never ran        |
| [#511](https://github.com/crackedstudio/sharibo/issues/511) | `e2e.ts` still shells out to `curl`; the test asserting otherwise is red |
| [#512](https://github.com/crackedstudio/sharibo/issues/512) | The `scripts` unit suite hits the live internet                          |
| [#536](https://github.com/crackedstudio/sharibo/issues/536) | Constraint-count guard may be stale after `recipientHash`                |
| [#553](https://github.com/crackedstudio/sharibo/issues/553) | `packages/client/README.md` is asserted by a test and 51 exports behind  |
| [#574](https://github.com/crackedstudio/sharibo/issues/574) | Three overlapping i18n test files                                        |

## Wave 2 — the duplication that can silently diverge

Highest consequence per line changed. Every entry is two copies of one thing.

| #                                                           | Issue                                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| [#467](https://github.com/crackedstudio/sharibo/issues/467) | `@sharibo/core` is entirely dead code — **decide direction first**         |
| [#468](https://github.com/crackedstudio/sharibo/issues/468) | Four crypto modules are byte-identical in core and client                  |
| [#469](https://github.com/crackedstudio/sharibo/issues/469) | "Dependency-free" core imports an undeclared `@stellar/stellar-sdk`        |
| [#470](https://github.com/crackedstudio/sharibo/issues/470) | knip has no `packages/core` block — which is why the orphan survived       |
| [#529](https://github.com/crackedstudio/sharibo/issues/529) | core ships raw TS as its entry point (blocks #467)                         |
| [#556](https://github.com/crackedstudio/sharibo/issues/556) | core's tsconfig doesn't extend the shared base                             |
| [#486](https://github.com/crackedstudio/sharibo/issues/486) | `contract.ts` declares `ResolvedSigner` twice                              |
| [#495](https://github.com/crackedstudio/sharibo/issues/495) | `explorer.test.ts` tests a module that doesn't exist; app has a third copy |
| [#496](https://github.com/crackedstudio/sharibo/issues/496) | `MemberRing`/`Stepper` exist twice; #305 and #312 never shipped            |
| [#497](https://github.com/crackedstudio/sharibo/issues/497) | Four dead components; `components/index.ts` exists to hide them from knip  |
| [#498](https://github.com/crackedstudio/sharibo/issues/498) | `MemberRing.module.css` is never imported                                  |
| [#505](https://github.com/crackedstudio/sharibo/issues/505) | Four different error→message paths in the app                              |
| [#557](https://github.com/crackedstudio/sharibo/issues/557) | `CIRCLE_SIZE = 5` declared three times; raw `1e7` instead of `formatXlm`   |

## Wave 3 — cross-language wire format

The one invariant the project documents as load-bearing. Every human-readable
statement of it is currently wrong.

| #                                                           | Issue                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| [#471](https://github.com/crackedstudio/sharibo/issues/471) | Public signal order stated as 3 signals in six docs; it is 4         |
| [#472](https://github.com/crackedstudio/sharibo/issues/472) | Contract error codes 10–12 have no SDK class and no docs row         |
| [#473](https://github.com/crackedstudio/sharibo/issues/473) | `prove.test.ts` pins `nPublic === 3` against a 4-signal key          |
| [#474](https://github.com/crackedstudio/sharibo/issues/474) | Single-source the public-input count across all three languages      |
| [#475](https://github.com/crackedstudio/sharibo/issues/475) | Clarify what actually binds `recipientHash`; add a negative test     |
| [#531](https://github.com/crackedstudio/sharibo/issues/531) | `test-vectors/generate.mjs` orphaned — fixtures can't be regenerated |
| [#566](https://github.com/crackedstudio/sharibo/issues/566) | XDR goldens cover `Circle` only, and only from the Rust side         |

## Wave 4 — contract

| #                                                           | Issue                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| [#476](https://github.com/crackedstudio/sharibo/issues/476) | Seven deprecated `events().publish` calls → `#[contractevent]`           |
| [#477](https://github.com/crackedstudio/sharibo/issues/477) | `claim` runs the 30M-instruction pairing before the free recipient guard |
| [#478](https://github.com/crackedstudio/sharibo/issues/478) | `lib.rs` still one 1,215-line module                                     |
| [#479](https://github.com/crackedstudio/sharibo/issues/479) | `test.rs` is 1,788 lines — 640 longer than when #235 was filed           |
| [#480](https://github.com/crackedstudio/sharibo/issues/480) | `Circle.nullifiers` grows without bound in a hot storage entry           |
| [#481](https://github.com/crackedstudio/sharibo/issues/481) | `get_circle` returns the whole vk on every poll                          |
| [#482](https://github.com/crackedstudio/sharibo/issues/482) | `schema_version` is 2 with no migration and no version check             |
| [#483](https://github.com/crackedstudio/sharibo/issues/483) | No Rust toolchain pin                                                    |
| [#534](https://github.com/crackedstudio/sharibo/issues/534) | `cargo fmt --check` and `clippy -D warnings` never run                   |
| [#544](https://github.com/crackedstudio/sharibo/issues/544) | Contract coverage discarded with `\|\| true`, threshold unwired          |
| [#564](https://github.com/crackedstudio/sharibo/issues/564) | One proptest property; eight more the invariants imply                   |
| [#565](https://github.com/crackedstudio/sharibo/issues/565) | TTL constants unanchored to the network's real archival window           |

## Wave 5 — SDK

| #                                                           | Issue                                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| [#485](https://github.com/crackedstudio/sharibo/issues/485) | `expire_round`, `propose_admin`, `accept_admin` unreachable from TS   |
| [#487](https://github.com/crackedstudio/sharibo/issues/487) | `ShariboSDK.getStatus()` is a wrong alias with a false doc comment    |
| [#488](https://github.com/crackedstudio/sharibo/issues/488) | The facade covers 7 of ~18 operations and has no consumer             |
| [#489](https://github.com/crackedstudio/sharibo/issues/489) | `@sharibo/client/internal` is documented but absent from `exports`    |
| [#493](https://github.com/crackedstudio/sharibo/issues/493) | `stroopsToXlm` truncates silently and is untested                     |
| [#494](https://github.com/crackedstudio/sharibo/issues/494) | Split `contract.ts` into connection / reads / writes                  |
| [#528](https://github.com/crackedstudio/sharibo/issues/528) | `CircleId` brand exists and is widened back to `bigint` everywhere    |
| [#530](https://github.com/crackedstudio/sharibo/issues/530) | No field-range validation before a claim is submitted                 |
| [#560](https://github.com/crackedstudio/sharibo/issues/560) | Observability events collected into state, surfaced nowhere           |
| [#567](https://github.com/crackedstudio/sharibo/issues/567) | `TxResult<T>` documented only by a helper's implementation            |
| [#568](https://github.com/crackedstudio/sharibo/issues/568) | Client cache: key, `onEvent` capture and invalidation all unspecified |
| [#579](https://github.com/crackedstudio/sharibo/issues/579) | Retry policy undocumented and only configurable per client            |

## Wave 6 — app

| #                                                           | Issue                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| [#499](https://github.com/crackedstudio/sharibo/issues/499) | Five of seven non-English locales are ~100 keys behind                      |
| [#500](https://github.com/crackedstudio/sharibo/issues/500) | `vite.config.ts` imports an undeclared `rollup-plugin-visualizer`           |
| [#501](https://github.com/crackedstudio/sharibo/issues/501) | Four dynamic imports of a statically-imported module; blocks the test suite |
| [#503](https://github.com/crackedstudio/sharibo/issues/503) | Harden debug-bundle redaction; redact rather than throw                     |
| [#504](https://github.com/crackedstudio/sharibo/issues/504) | `app` has no `typecheck` script                                             |
| [#506](https://github.com/crackedstudio/sharibo/issues/506) | `app/src/lib/session.ts` was never created                                  |
| [#507](https://github.com/crackedstudio/sharibo/issues/507) | `style.css` still 1,100 lines after the #308 split                          |
| [#508](https://github.com/crackedstudio/sharibo/issues/508) | Extract the twelve inline components from `App.tsx`                         |
| [#509](https://github.com/crackedstudio/sharibo/issues/509) | `__mocks__/` sits outside every workspace, unlinted and untypechecked       |
| [#510](https://github.com/crackedstudio/sharibo/issues/510) | Unused `buffer` polyfill and `global` define                                |
| [#538](https://github.com/crackedstudio/sharibo/issues/538) | Nine a11y issues shipped with no regression guard                           |
| [#539](https://github.com/crackedstudio/sharibo/issues/539) | No bundle budget, so #300 can't be closed credibly                          |
| [#558](https://github.com/crackedstudio/sharibo/issues/558) | Browser-capability gate and offline detection untested                      |
| [#559](https://github.com/crackedstudio/sharibo/issues/559) | Friendbot rate-limit path untested; it is the demo's first step             |
| [#573](https://github.com/crackedstudio/sharibo/issues/573) | Contribution amount not validated before signing                            |
| [#575](https://github.com/crackedstudio/sharibo/issues/575) | Locale expansion and RTL support                                            |

## Wave 7 — tooling, scripts, circuits

| #                                                           | Issue                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| [#513](https://github.com/crackedstudio/sharibo/issues/513) | `config.test.ts` spawns a subprocess per case — 12s for string validation |
| [#514](https://github.com/crackedstudio/sharibo/issues/514) | Three test runners; two vitest majors apart                               |
| [#515](https://github.com/crackedstudio/sharibo/issues/515) | Prettier configured with no runner and no dependency                      |
| [#516](https://github.com/crackedstudio/sharibo/issues/516) | No `engines` field anywhere                                               |
| [#517](https://github.com/crackedstudio/sharibo/issues/517) | `doctor.ts` misses every failure mode the repo actually produces          |
| [#518](https://github.com/crackedstudio/sharibo/issues/518) | Two maintenance checkers exist; no gate runs either                       |
| [#532](https://github.com/crackedstudio/sharibo/issues/532) | Mutation score recorded in markdown, unenforced                           |
| [#533](https://github.com/crackedstudio/sharibo/issues/533) | Proving benchmark produces no committed record                            |
| [#535](https://github.com/crackedstudio/sharibo/issues/535) | Circuit suite needs a toolchain nobody provisions                         |
| [#537](https://github.com/crackedstudio/sharibo/issues/537) | **Repo-structure test suite** — the guard for ten docs↔tree invariants    |
| [#569](https://github.com/crackedstudio/sharibo/issues/569) | `e2e.ts` has no machine-readable output for a canary                      |
| [#570](https://github.com/crackedstudio/sharibo/issues/570) | `smoke.ts` decisions untested — and it is about to carry monitoring       |
| [#571](https://github.com/crackedstudio/sharibo/issues/571) | Artifact-integrity checkers have no failing fixtures                      |
| [#578](https://github.com/crackedstudio/sharibo/issues/578) | `scripts/maintenance/` unlinted and untested                              |

## Wave 8 — documentation accuracy

Do these **after** the code they describe, so the corrected claims are true when written.

| #                                                           | Issue                                                                      |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| [#519](https://github.com/crackedstudio/sharibo/issues/519) | Two `vercel.json`, no documented deployment path                           |
| [#520](https://github.com/crackedstudio/sharibo/issues/520) | `docs/index.md` claims completeness, omits 13 documents                    |
| [#521](https://github.com/crackedstudio/sharibo/issues/521) | Four ADRs numbered 003; no 005                                             |
| [#522](https://github.com/crackedstudio/sharibo/issues/522) | `docs/roadmap.md` presents ~18 closed issues as open                       |
| [#523](https://github.com/crackedstudio/sharibo/issues/523) | `TODO.md` is a finished personal checklist at the repo root                |
| [#524](https://github.com/crackedstudio/sharibo/issues/524) | `SECURITY.md` cites a gitignored file and a `.local` email domain          |
| [#525](https://github.com/crackedstudio/sharibo/issues/525) | Test counts advertised as 5/5 and 8/8                                      |
| [#526](https://github.com/crackedstudio/sharibo/issues/526) | README claims an `overrides` entry and install hook; neither exists        |
| [#527](https://github.com/crackedstudio/sharibo/issues/527) | `docs/architecture.md` never mentions `packages/core`                      |
| [#540](https://github.com/crackedstudio/sharibo/issues/540) | No CHANGELOG; every package is `0.0.0` while on-chain state is versioned   |
| [#541](https://github.com/crackedstudio/sharibo/issues/541) | CODEOWNERS: one owner for all paths, defeating its own rule                |
| [#542](https://github.com/crackedstudio/sharibo/issues/542) | PR template omits 318 tests and three static checks                        |
| [#543](https://github.com/crackedstudio/sharibo/issues/543) | Issue templates apply no topic label                                       |
| [#545](https://github.com/crackedstudio/sharibo/issues/545) | `NOTES.md` mixes current reference with superseded history                 |
| [#554](https://github.com/crackedstudio/sharibo/issues/554) | `contracts/README.md` behind by seven entrypoints and four error codes     |
| [#555](https://github.com/crackedstudio/sharibo/issues/555) | On-chain evidence pins a July 2026 deployment and a 3-signal proof         |
| [#561](https://github.com/crackedstudio/sharibo/issues/561) | `full_product_breakdown.md`: stale instruction counts, duplicated sections |
| [#562](https://github.com/crackedstudio/sharibo/issues/562) | `app/README.md` documents a build that can't run on a fresh clone          |
| [#563](https://github.com/crackedstudio/sharibo/issues/563) | `docs/glossary.md` teaches the old public-signal set                       |
| [#576](https://github.com/crackedstudio/sharibo/issues/576) | Hackathon-era documents linked as current                                  |
| [#577](https://github.com/crackedstudio/sharibo/issues/577) | `good first issue` points into a repo that doesn't build                   |

## Wave 9 — mainnet prerequisites

The six items `docs/roadmap.md` listed as _"not yet filed"_. Now filed, so the
checklist has no untracked entries. Two are marked there as hard prerequisites.

| #                                                           | Issue                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| [#546](https://github.com/crackedstudio/sharibo/issues/546) | Run a real multi-party trusted-setup ceremony                |
| [#547](https://github.com/crackedstudio/sharibo/issues/547) | 🔒 Independent audit of the ZK circuit                       |
| [#548](https://github.com/crackedstudio/sharibo/issues/548) | 🔒 Independent audit of the Soroban contract                 |
| [#549](https://github.com/crackedstudio/sharibo/issues/549) | Implement on-chain turn ordering (ADR 002 is still Proposed) |
| [#550](https://github.com/crackedstudio/sharibo/issues/550) | Monitoring and alerting on the deployed contract             |
| [#551](https://github.com/crackedstudio/sharibo/issues/551) | Incident-response plan                                       |
| [#552](https://github.com/crackedstudio/sharibo/issues/552) | Key custody for circle admins and `fee_recipient`            |

---

## Three guards worth landing early

Most of this backlog is one defect repeated. Three issues are the mechanisms that stop
the repetition, and each is cheap:

- **[#461](https://github.com/crackedstudio/sharibo/issues/461) + [#572](https://github.com/crackedstudio/sharibo/issues/572) — CI, with one gate definition.** Nine of the Wave 0/1 items could not have landed.
- **[#537](https://github.com/crackedstudio/sharibo/issues/537) — the repo-structure suite.** Ten docs↔tree invariants, a few lines each. Covers #520, #521, #525, #526, #527, #554, #563 permanently.
- **[#470](https://github.com/crackedstudio/sharibo/issues/470) — knip over every workspace.** An entire orphaned package was invisible because one config block was missing.
