# Contributing to Sharibo

Thank you for your interest in contributing to Sharibo! This document provides guidelines and information to help you get started.

## Labels

We use a set of topic labels to categorize issues and pull requests. These labels help maintainers and contributors understand the scope and nature of each issue.

### Topic Labels

| Label         | Description                     | Maps to                           |
| ------------- | ------------------------------- | --------------------------------- |
| frontend      | React demo app                  | `app/`                            |
| sdk           | TypeScript client SDK           | `packages/client`                 |
| contracts     | Soroban smart contract          | `contracts/`                      |
| circuits      | Circom circuit & ZK tooling     | `circuits/`                       |
| testing       | Tests and test infrastructure   | Various test directories          |
| dx            | Developer experience & tooling  | Tooling, scripts, configuration   |
| a11y          | Accessibility                   | UI/UX components                  |
| ux            | User experience & polish        | UI/UX components                  |
| security      | Security & robustness           | Security-related code             |
| e2e           | End-to-end script               | `scripts/e2e.ts`                  |
| refactor      | Code structure improvements     | Codebase-wide                     |
| performance   | Speed & resource usage          | Performance-critical code         |
| roadmap       | Larger feature from the roadmap | Planned features                  |
| architecture  | Structural / design decisions   | Architecture proposals, ADRs      |
| tech-debt     | Known shortcuts to pay down     | Deferred cleanups                 |
| observability | Logging, metrics, tracing       | Observability code                |
| i18n          | Internationalization            | User-facing strings               |
| harden        | Robustness hardening            | Input validation, error paths     |
| api           | Public API surface              | SDK exports, contract entrypoints |

### GitHub Default Labels

| Label            | Description                                | Maps to                                 |
| ---------------- | ------------------------------------------ | --------------------------------------- |
| good first issue | Good for newcomers                         | Any area, suitable for new contributors |
| documentation    | Improvements or additions to documentation | `docs/`, README files, code comments    |
| bug              | Something isn't working                    | Any area with defects                   |
| duplicate        | This issue or pull request already exists  | N/A                                     |
| enhancement      | New feature or request                     | Any area                                |
| help wanted      | Extra attention is needed                  | Any area needing help                   |
| invalid          | This doesn't seem right                    | N/A                                     |
| question         | Further information is requested           | N/A                                     |
| wontfix          | This will not be worked on                 | N/A                                     |

### Special Labels

| Label        | Description                        | Maps to                    |
| ------------ | ---------------------------------- | -------------------------- |
| Stellar Wave | Issues in the Stellar wave program | Stellar Wave program tasks |

## Dead code (knip)

`knip.jsonc` states that **zero issues is the baseline**. A knip finding is resolved by **deleting the code or wiring it into the running app** — never by adding a reference that exists only to satisfy the checker.

- Do not add barrel files (`index.ts`) whose stated purpose is to make knip see components as referenced. If nothing imports the barrel, knip reports the barrel _and_ the components, so the workaround makes the report worse, not better.
- Import components by path (`./components/Foo`) rather than through a barrel.
- If a component is not rendered by the app, either adopt it into the render tree or delete it. Leaving it in place with a fake reference misleads anyone reading the directory to understand the UI.
- Do not add `knip.jsonc` entries to silence a finding for the same reason.

## Review expectations

This repo historically had **no CI**, so human review remains the primary gate — a merged PR is effectively the last check before the code lands. Contract line-coverage is now also enforced in GitHub Actions (`.github/workflows/coverage.yml`) against `coverage-thresholds.json`. `.github/CODEOWNERS` requests the owning reviewers automatically on every PR.

- **Reviewers confirm the gate passed on the merge result.** Because there is no CI, the reviewer is responsible for confirming the local verification gate passes on the **merge result**, not just on the branch as it was pushed. Today that means running `just all` (circuit tests, contract tests, client typecheck; e2e separately), and the umbrella `just verify` recipe that codifies this is tracked in issue [#222](https://github.com/crackedstudio/sharibo/issues/222) — merge conflicts resolved carelessly are how landed work gets silently reverted.
- **Security-critical paths require a domain reviewer.** `circuits/**` and `contracts/**` changes must be reviewed by someone who reads circom / Rust respectively, not just by whoever happens to be around.
- **The wire-format boundary needs review on all three sides.** Any PR touching circuit public signals (`circuits/`), contract `public_inputs` (`contracts/`), or SDK encoding (`packages/client/`) must be reviewed on all three sides. The public signal order `[nullifierHash, root, externalNullifier, recipientHash]` and the BLS12-381 field encoding are load-bearing invariants that only hold if circuit, contract, and client agree — see [docs/wire-format.md](docs/wire-format.md).

## Accessibility

**The bar for this repo is WCAG 2.1 Level AA**, and it is enforced, not
aspirational. `app/src/a11y.test.tsx` runs axe-core against every screen and
asserts zero violations; `app/src/a11y.styles.test.ts` checks the colour
tokens and the `prefers-reduced-motion` / `prefers-color-scheme` media
queries in `app/src/style.css`. Both run in the **App** GitHub Actions
workflow. Treat an a11y regression the same way you would a failing test.

Two things to know before you touch the UI:

- **Contrast is checked at the token level, not by axe.** jsdom implements
  almost none of the CSS cascade, so axe's `color-contrast` rule reports
  nothing useful in a unit test. `a11y.styles.test.ts` parses `style.css` and
  computes the WCAG ratios directly, which is why adding a new text colour
  means adding it to the `PAIRS` list in that file too.
- **Some contrast failures are known and pinned.** Writing the guard surfaced
  real AA shortfalls, mostly in the dark theme, where the
  `prefers-color-scheme: dark` block overrides `--ink`/`--bg`/`--card` but not
  the light-only `--surface-*` and `--text-*` tokens. Each is listed in
  `KNOWN_SHORTFALLS` and pinned with `it.fails`, so the suite stays green
  while the defect stays visible. **Fixing one of those colours makes its
  `it.fails` go red** — that is the signal to delete the entry, not a bug in
  the guard. Do not add a new entry to silence a failing test.

The audience is ROSCA participants worldwide, including on low-end devices and
screen readers, so keyboard reachability, visible focus, and the polite live
region are load-bearing. A change that makes the UI quieter for sighted users
is a regression even when it looks like a cleanup.

## Code Formatting

This repository uses Prettier for formatting. The baseline was established in a single bulk commit (`388bcd83218b7385edef30ec0e30a729583b4dcc`) to avoid obscuring real diffs. You can configure your local git to skip this commit in `git blame` output:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Filing an issue

Use the templates in `.github/ISSUE_TEMPLATE/`: **Bug Report** for defects, **Feature Request** for new capabilities, and **Refactor / Architecture Proposal** for restructuring work — when there is no bug and no new feature, but there is a current shape, a proposed shape, a blast radius, and a migration path (e.g. moving code between packages, changing the contract's storage layout, changing the circuit's public signals). The refactor template requires the "where" (current state with file paths) and a behaviour-preservation plan, because those are the two things a refactor issue most often leaves out.

## Picking an Issue

When looking for issues to work on, start by filtering by the `good first issue` label. These issues are specifically marked as suitable for newcomers and provide a great way to get familiar with the codebase. Before you start working on an issue, leave a comment to claim it and let the maintainers know you're working on it. If you have questions about the issue or need clarification, ask them directly on the issue rather than in a pull request—this helps keep the PR focused on the implementation.

Per-task scratch files (e.g. `TODO.md`, checklists, or notes) are not committed; use the issue thread to track your work instead.

## SDK API Changes

The SDK (`@sharibo/client`) has a committed snapshot of its public API surface in `packages/client/api-surface.json`. When you intentionally add, remove, or rename exported functions, types, or constants, the test `packages/client/src/api-surface.test.ts` will catch the mismatch.

### Updating the API Snapshot

If your change is intentional (e.g., renaming a function, adding a new export):

1. Make your code change and run the test:

   ```bash
   npm run test -- packages/client/src/api-surface.test.ts
   ```

2. The test will fail with a diff showing what changed.

3. Review the diff carefully to confirm it matches your intent.

4. Update `packages/client/api-surface.json` to match the new API:

   ```bash
   npm run test -- packages/client/src/api-surface.test.ts --reporter=json > /tmp/api.json
   ```

   Then copy the actual exports into `api-surface.json`.

5. Commit both your code changes and the updated `api-surface.json` together. This makes it easy to see in the PR what the API change is.

If the test fails unexpectedly, it means you've inadvertently changed the public API. Consider whether that's the right fix, or if you should rename more carefully or preserve backward compatibility.

## Where does my code go?

Decide which workspace a new file (or a moved one) belongs to before writing code. The authoritative answer is the ownership map and layer diagram in **[docs/architecture.md](docs/architecture.md)**; as a quick decision list:

| What you're writing                                                                                       | Where it lives    |
| --------------------------------------------------------------------------------------------------------- | ----------------- |
| Pure crypto — Poseidon hashing, Merkle trees, identity/nullifier derivation, field arithmetic, no I/O     | `packages/core`   |
| Anything touching Stellar RPC — contract calls, proof generation, amount/address encoding, network config | `packages/client` |
| Anything touching the DOM — React components, browser-only UI state                                       | `app/`            |
| One-off operator tooling — smoke probes, the e2e round runner, migrations                                 | `scripts/`        |

Two rules are load-bearing and will be enforced in review:

- **The SDK stays Node-importable with no DOM.** `packages/client` (and its dependency `packages/core`) must import cleanly in Node with `document` deliberately undefined — `packages/client/src/node-import.test.ts` guards this. Reaching for `window`, `document`, or `node:*` inside the SDK is a review blocker.
- **Shared constants are imported, never re-typed.** A constant meaningful to more than one workspace lives in the SDK (`packages/core` if it's pure crypto, otherwise `packages/client`), is exported from its entry point, and is imported by consumers. Duplicating a value "just to keep the change local" is how the circuit/contract/client invariants silently drift apart.

Still unsure where a file belongs? Ask on the issue before opening the PR — a reviewer should be able to cite this section (or [Import rules](#import-rules) below) when asking for a file to be moved.

## Import rules

Each package layer has defined boundaries about what it may import. Before adding a new `import`
statement, consult **[docs/architecture.md](docs/architecture.md)** for the full layering diagram
and the rules enforced by ESLint.

In short:

- `app/` and `scripts/` must import the SDK via `@sharibo/client` (its published entry point), **never** a deep `packages/client/src/…` path.
- `packages/client` must not import `app/` or `scripts/`.
- `contracts/` and `circuits/` have no JavaScript import dependencies on the rest of the monorepo.

Running `npm run lint` will catch violations.

## Setup trouble?

Getting a fresh machine running and tripping on a toolchain issue (`circom`, `wasm32v1-none`, `stellar` vs `soroban`, friendbot limits, testnet resets, missing `circuits/build/`)? See [docs/troubleshooting.md](docs/troubleshooting.md) for symptom → cause → fix walkthroughs.

## Tests must be hermetic

**The default test command must pass with networking disabled.**

`npm test` (and `just test`, `just scripts-test`) contacts no host, spends no
friendbot quota, and must not fail because a third-party service is down, a
proxy rejected you, or you are on a plane. A unit suite that reaches the network
cannot be a gate, and a suite that is red for environmental reasons trains
contributors to ignore red.

Concretely, for `scripts/`:

|                                                                               |                                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Default** — `npm test --workspace=scripts`                                  | Hermetic. Glob is `*.test.ts`. Stub `fetch`, or point at a local `http.createServer`. |
| **Live** — `npm run test:live --workspace=scripts` (`just scripts-test-live`) | Opt-in. May reach friendbot / Horizon / testnet. Naming convention: `*.live.ts`.      |
| **Probe** — `npm run smoke`                                                   | The live read-only deployment health check. Not part of any suite.                    |

Rules of thumb:

- **Never call a public host from a `*.test.ts`.** If you need a slow response, a
  4xx, or a 500, serve it from a local `http.createServer` — hermetic and faster.
  `httpbin.org` is explicitly not acceptable: a public demo service with no
  availability guarantee.
- **Never call friendbot from a test suite.** `just test` deliberately keeps
  e2e out of the default path because it needs live funds and friendbot quota.
  A test that calls friendbot bypasses that on purpose.
- **A URL in a fixture is not a request**, but prefer a reserved TLD
  (`https://rpc.invalid`, `https://example.test`) over a real hostname anyway,
  so nobody later adds a call against a value that was only ever meant to be a
  string. RFC 2606 reserves `.invalid`, `.test` and `.example`; they can never
  resolve.
- **Do not mutate the developer's `.env`.** Point the script at a throwaway
  fixture with `SHARIBO_ENV_FILE`, or hand the child process an explicit
  environment. `node --test` runs files in parallel, so two test files writing
  the same shared file race.

These rules are enforced, not just documented: `scripts/hermeticity.test.ts`
fails the default suite if any file in the default glob names a host outside the
allowlist, or if the two globs stop being disjoint.

> **Why live tests are named `*.live.ts` and not `*.live.test.ts`:** Node's
> `--test` glob has no exclusion syntax. Passing `"!*.live.test.ts"` is
> silently ignored, and a `*.test.ts` glob matches `*.live.test.ts` anyway — so
> a live test named that way runs in the default suite and burns friendbot
> quota on every `npm test`. A `.live.ts` suffix cannot be matched by a
> `*.test.ts` glob, which is the only thing that reliably separates the two
> lanes. `hermeticity.test.ts` asserts the invariant, so the naming cannot be
> "tidied up" back into a silent regression.

## Pre-PR checklist

Before opening a pull request, run the authoritative local verification gate:

- Run `just ci` from anywhere inside the repository. This is the **same gate CI runs** — TypeScript SDK build, typecheck, `npm run lint`, `npm run lint:dead`, every unit suite (app, client, scripts, circuits checkers, repo-structure), `cargo fmt --check`, `cargo clippy --all-targets -D warnings`, `cargo test`, and `stellar contract build`.
- `just verify` is a **fast pre-commit subset** only (typecheck + lint + client/app unit tests). It is not sufficient for a PR.
- The gate intentionally excludes `e2e`, circuit trusted setup (`just circuits`), mutation, and benchmarks — those are slow and/or spend testnet friendbot funds. Run them on demand when your change touches those areas.

If `just ci` passes locally, it's the single documented answer to "did I break anything?" and a good signal your change is ready for review.
