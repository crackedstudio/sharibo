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

## Picking an Issue

When looking for issues to work on, start by filtering by the `good first issue` label. These issues are specifically marked as suitable for newcomers and provide a great way to get familiar with the codebase. Before you start working on an issue, leave a comment to claim it and let the maintainers know you're working on it. If you have questions about the issue or need clarification, ask them directly on the issue rather than in a pull request—this helps keep the PR focused on the implementation.

## Setup trouble?

Getting a fresh machine running and tripping on a toolchain issue (`circom`, `wasm32v1-none`, `stellar` vs `soroban`, friendbot limits, testnet resets, missing `circuits/build/`)? See [docs/troubleshooting.md](docs/troubleshooting.md) for symptom → cause → fix walkthroughs.

## Dependency Management Policy

This repository pins exact versions for critical dependencies to ensure deterministic builds and avoid cryptographic inconsistencies across workspaces.

### Version Pinning Rationale

- **`poseidon-bls12381` and `poseidon-bls12381-circom`** are intentionally pinned to exact versions (e.g., `1.0.2` and `1.0.0`). These are cryptographic primitives; even a minor version change can alter field operations and break consensus or verification. They must always move together—updating one without the other would create a mismatch between circuit definitions and their implementations.

- **`react` and `vite`** are pinned to specific minor versions (`19.2.7` and `8.1.3` respectively) to guarantee stable tooling behavior and avoid unexpected breaking changes from auto-updates.

- **`@stellar/stellar-sdk`** must be consistent across all npm workspaces. The script `scripts/check-stellar-sdk-version.mjs` enforces this; all workspaces must declare the same version range.

### Update Cadence

- **Monthly:** A maintainer must run `npm audit` and `cargo audit` to identify and assess vulnerabilities.
- **Quarterly:** A maintainer may bump minor versions (e.g., `^16.2.0` → `^16.3.0`) after local verification. Patch bumps (`^16.2.0` → `^16.2.1`) are permitted between quarterly cycles if they resolve critical security issues.

**Responsibility:** Maintainers are responsible for executing the audit and bump cadence. Contributors should not modify dependency versions without maintainer oversight.

### Verification — No CI

> **⚠️ WARNING: This repository has no CI pipeline running on pull requests.** All dependency updates must be thoroughly verified locally before merging. Run the full test suite, `npm audit`, and `cargo audit` on your machine; only merge if everything passes cleanly.
