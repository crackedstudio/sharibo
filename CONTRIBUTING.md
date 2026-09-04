# Contributing to Sharibo

Thank you for your interest in contributing to Sharibo! This document provides guidelines and information to help you get started.

## Labels

We use a set of topic labels to categorize issues and pull requests. These labels help maintainers and contributors understand the scope and nature of each issue.

### Topic Labels

| Label | Description | Maps to |
|-------|-------------|---------|
| frontend | React demo app | `app/` |
| sdk | TypeScript client SDK | `packages/client` |
| contracts | Soroban smart contract | `contracts/` |
| circuits | Circom circuit & ZK tooling | `circuits/` |
| testing | Tests and test infrastructure | Various test directories |
| dx | Developer experience & tooling | Tooling, scripts, configuration |
| a11y | Accessibility | UI/UX components |
| ux | User experience & polish | UI/UX components |
| security | Security & robustness | Security-related code |
| e2e | End-to-end script | `scripts/e2e.ts` |
| refactor | Code structure improvements | Codebase-wide |
| performance | Speed & resource usage | Performance-critical code |
| roadmap | Larger feature from the roadmap | Planned features |

### GitHub Default Labels

| Label | Description | Maps to |
|-------|-------------|---------|
| good first issue | Good for newcomers | Any area, suitable for new contributors |
| documentation | Improvements or additions to documentation | `docs/`, README files, code comments |
| bug | Something isn't working | Any area with defects |
| duplicate | This issue or pull request already exists | N/A |
| enhancement | New feature or request | Any area |
| help wanted | Extra attention is needed | Any area needing help |
| invalid | This doesn't seem right | N/A |
| question | Further information is requested | N/A |
| wontfix | This will not be worked on | N/A |

### Special Labels

| Label | Description | Maps to |
|-------|-------------|---------|
| Stellar Wave | Issues in the Stellar wave program | Stellar Wave program tasks |

## Review expectations

This repo has **no CI**, so human review is the gate — a merged PR is effectively the last check before the code lands. `.github/CODEOWNERS` requests the owning reviewers automatically on every PR.

- **Reviewers confirm the gate passed on the merge result.** Because there is no CI, the reviewer is responsible for confirming the local verification gate passes on the **merge result**, not just on the branch as it was pushed. Today that means running `just all` (circuit tests, contract tests, client typecheck; e2e separately), and the umbrella `just verify` recipe that codifies this is tracked in issue [#222](https://github.com/crackedstudio/sharibo/issues/222) — merge conflicts resolved carelessly are how landed work gets silently reverted.
- **Security-critical paths require a domain reviewer.** `circuits/**` and `contracts/**` changes must be reviewed by someone who reads circom / Rust respectively, not just by whoever happens to be around.
- **The wire-format boundary needs review on all three sides.** Any PR touching circuit public signals (`circuits/`), contract `public_inputs` (`contracts/`), or SDK encoding (`packages/client/`) must be reviewed on all three sides. The public signal order `[nullifierHash, root, externalNullifier]` and the BLS12-381 field encoding are load-bearing invariants that only hold if circuit, contract, and client agree.

## Filing an issue

Use the templates in `.github/ISSUE_TEMPLATE/`: **Bug Report** for defects, **Feature Request** for new capabilities, and **Refactor / Architecture Proposal** for restructuring work — when there is no bug and no new feature, but there is a current shape, a proposed shape, a blast radius, and a migration path (e.g. moving code between packages, changing the contract's storage layout, changing the circuit's public signals). The refactor template requires the "where" (current state with file paths) and a behaviour-preservation plan, because those are the two things a refactor issue most often leaves out.

## Picking an Issue

When looking for issues to work on, start by filtering by the `good first issue` label. These issues are specifically marked as suitable for newcomers and provide a great way to get familiar with the codebase. Before you start working on an issue, leave a comment to claim it and let the maintainers know you're working on it. If you have questions about the issue or need clarification, ask them directly on the issue rather than in a pull request—this helps keep the PR focused on the implementation.

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

| What you're writing | Where it lives |
| ------------------- | -------------- |
| Pure crypto — Poseidon hashing, Merkle trees, identity/nullifier derivation, field arithmetic, no I/O | `packages/core` |
| Anything touching Stellar RPC — contract calls, proof generation, amount/address encoding, network config | `packages/client` |
| Anything touching the DOM — React components, browser-only UI state | `app/` |
| One-off operator tooling — smoke probes, the e2e round runner, migrations | `scripts/` |

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

## Pre-PR checklist

Before opening a pull request, run the comprehensive local verification gate:

- Run `just verify` from anywhere inside the repository. It runs TypeScript typechecking (client and app), ESLint, a best-effort dead-code check (`ts-prune`), all unit tests (app and SDK), `cargo test`, and `cargo clippy -- -D warnings`.
- The recipe intentionally excludes `e2e` and the circuits *trusted setup* because those are slow and/or spend testnet friendbot funds.

If `just verify` passes locally, it's the single documented answer to "did I break anything?" and a good signal your change is ready for review.
