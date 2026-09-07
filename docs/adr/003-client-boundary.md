# ADR 003: Client boundary between app, SDK, and contract

- **Status:** Accepted
- **Date:** 2026-08-30
- **Context:** Decision record for the contract-facing boundary used by the browser app, the client SDK, and the runtime contract API discovery.

## Context

The project currently uses a three-layer design:

1. The browser app owns orchestration and user UX.
2. The SDK exposes a small set of free functions that operate on an untyped client object.
3. The contract interface is discovered at runtime from Soroban metadata / generated server-side contract bindings, rather than being code-generated into a fully-typed, package-level API.

This shape is a pragmatic outcome of the hackathon phase: the team needed to ship a working demo quickly, without first stabilizing a typed contract schema, without a final SDK facade, and without blocking the app on a large codegen or abstraction layer.

The boundary is visible in the current code: the app orchestrates flows, while the SDK methods roughly correspond to contract operations (`create_circle`, `fund`, `claim`, `get_circle`, etc.) and accept `client` as the first argument. They are deliberately thin and free-function oriented rather than a stateful `ShariboSDK` object.

That choice has been workable because the contract API was still evolving, the exact wire format was not yet a stable public product surface, and the project needed to move quickly with a small amount of code that could change without broad refactors.

## Decision drivers

### Why the current boundary was chosen

Under hackathon time pressure, the design optimized for the following:

- **Fast iteration:** the contract and app both changed while the project was still proving the core idea.
- **Low ceremony:** no generated client layer or wrapper API to maintain while the schema was in flux.
- **Runtime flexibility:** Soroban contract specs and runtime values can be re-discovered without a full regen of every call site.
- **Minimal architectural commitment:** the app can orchestrate calls while the SDK remains a thin, composable layer rather than a richer object model that may be wrong before the product constraints are stable.

This is the cheapest path to get a working end-to-end flow: app logic + SDK free functions + contract runtime discovery.

### Options considered

#### Option A — Free functions + untyped client (status quo)

This is the current design.

- **Shape:** `fund(client, args)`, `claim(client, args)`, etc.
- **Strengths:** minimal setup, easy to call from the app, flexible during a moving target contract API, small footprint, easy to evolve with the contract.
- **Weaknesses:** the client is effectively `any`, so the boundary is not self-documenting; TypeScript does not protect call sites from drift; package boundaries are looser than a formal typed SDK.

#### Option B — Generated bindings + thin wrappers

A generated contract client would give us typed call signatures and stronger validation of contract and SDK agreement.

- **Strengths:** clear public API, tooling support, stronger compile-time correctness, easier for downstream apps to use safely.
- **Weaknesses:** requires a stable contract schema and a code generation flow that is currently more expensive than the project needs; the generated layer creates churn when the contract is still evolving; it is a better fit once the boundary is settled.

#### Option C — Stateful `ShariboSDK` facade

A stateful SDK object would own config, client-lifecycle management, and convenience methods for common flows.

- **Strengths:** clean app-facing object model, better ergonomics for a product-grade SDK, easier to maintain as a public API if we want one shared facade.
- **Weaknesses:** too much abstraction too early; it hard-wires a design decision before the contract boundary is settled; it creates a broader API surface than the project currently needs; it would be premature under a hackathon timeline.

## Decision

Keep the current boundary as the authoritative design for now:

- the app remains the orchestrator,
- the SDK remains a thin collection of free functions,
- the contract spec remains discovered at runtime,
- the `client` parameter remains untyped in the SDK surface as a deliberate, minimal boundary.

This is the right decision for the current phase because the contract is still evolving and the project is still validating the overall product shape. The cost of prematurely formalizing the boundary would be higher than the benefit of a cleaner public API.

We will not introduce a typed generated client or a stateful SDK facade until the project has a stable contract spec and a concrete product-level API contract to preserve. At that point, the work should move into the follow-up issues for typed bindings and the SDK facade.

## Consequences

### Positive

- The project keeps moving quickly with a small API surface.
- The app can adapt to contract changes without a major SDK refactor.
- The boundary remains intentionally thin and composable.
- This is easier to maintain before the contract stabilizes.

### Negative

- The SDK does not give compile-time guarantees about contract shape.
- The app can drift from the contract API without strong structural feedback.
- Package boundaries are intentionally loose and may be less ergonomic for consumers.
- The design is a deliberate compromise rather than a final public API.

### Follow-up work

This ADR should be read alongside the implementation work for:

- typed bindings: [Typed bindings issue](https://github.com/crackedstudio/sharibo/issues?q=typed+bindings)
- SDK facade: [SDK facade issue](https://github.com/crackedstudio/sharibo/issues?q=SDK+facade)

These are the issues that will carry the eventual migration from the current thin free-function boundary to a stricter, product-grade interface once the contract and app architecture settle.

## Related issues

- [Typed bindings](https://github.com/crackedstudio/sharibo/issues?q=typed+bindings)
- [SDK facade](https://github.com/crackedstudio/sharibo/issues?q=SDK+facade)

## Summary

The project chose a deliberately minimal contract boundary under time pressure: free functions over an untyped client, app-managed orchestration, and runtime contract discovery. That is the right choice for now, but it should be treated as a transitional architecture, not the final public shape of the SDK.

---

## Addendum — proposal: the `ShariboSDK` facade (issue #284)

- **Status:** Proposed
- **Date:** 2026-07-30
- **Tracked by:** GitHub issue #284
- **Relates to:** ADR 001 (upgradeability), issue #123 (removal of the old
  client-side proof/verifier helpers), `packages/client/src/contract.ts`

## Context

Every consumer of `@sharibo/client` — the e2e script, the smoke script, and
the React app — talks to the contract the same way today:

1. build a dynamically-typed `ShariboClient` via `connect(config, signer)`;
2. thread that client into a free function: `createCircle(client, ...)`,
   `fund(client, ...)`, `claim(client, ...)`, `getCircle(client, ...)`.

The free-function API is thin, so this works, but it has real costs:

- **Callers own the plumbing.** Every call site repeats *"connect once, pass
  the client everywhere"* and every new caller must learn the pattern. The
  e2e script connects **seven** clients (one admin + five members) and
  passes them around manually; the app interleaves `connect` with `fund` /
  `claim` / `getCircle` in the same breath.
- **`ShariboClient` is untyped (`any`).** The dynamic contract client is
  deliberately `any` (it's generated from the on-chain spec at runtime), so
  the *only* typed surface a caller sees is the free functions' argument
  lists. Threading the raw client puts an untyped value at every call site.
- **Retry policy has nowhere to live.** Retry-backoff (`withRetry`) exists on
  the free functions, but there is no single place a caller declares "I want
  per-call retries" once and forgets it.

## The boundary

The boundary we care about is **between the `@sharibo/client` package and its
consumers**: consumers should not have to know how the contract client is
constructed, how a signer is resolved, or how retries are configured. They
should hold one value that does `createCircle` / `fund` / `claim` /
`getCircle` / `hasClaimed` against a fixed network + signer, and only
bump into the free functions when they genuinely need them.

That value is **`ShariboSDK`**:

```ts
const sdk = await ShariboSDK.connect(
  { contractId, rpcUrl, networkPassphrase },
  keypair,
  { retryPolicy },      // optional, defaults to exponential backoff
);

const { result: circleId, hash } = await sdk.createCircle({ ... });
await sdk.fund({ circleId, from });
await sdk.claim({ circleId, recipient, nullifierHash, externalNullifier, proof });
const circle = await sdk.getCircle(circleId);
const alreadyClaimed = await sdk.hasClaimed(circleId, nullifierHash);
```

Nobody threads a `client` anymore; the SDK binds network + signer + retry
policy once at construction.

## Priority ordering (facade first)

For any new feature that touches the contract, we do **facade-first**:

1. **Add the method to `ShariboSDK`** — this is the public surface consumers
   are expected to use.
2. Only if the SDK method needs to delegate to a non-trivial implementation,
   add it as a **free function in `contract.ts`** behind the facade (thin
   wrapper, one release). The free function stays because it's cheap to keep
   and it gives power users an escape hatch, not because new call sites
   should use it.
3. **Update every in-repo caller** (scripts, app) to go through the facade in
   the same PR that adds the method — no new `client`-threading call sites.

Free functions that currently take a `ShariboClient` remain exported for one
release so existing users don't break, but **new code must not add callers
that thread the client**.

## JUMP plan (keep the API honest)

A heavy-worth-it API is a promise; the free functions are the legacy surface.
The JUMP plan keeps that promise cheap:

- **Justification:** anything that turns out to need the raw `client` is a
  candidate for promotion into the SDK — expose it as a method rather than
  documenting "yes, please thread the client."
- **Usability:** every method the SDK exposes must be documented with the
  same JSDoc the free function carries, so the facade isn't a blind proxy.
- **Migration:** the SDK's internals reuse `connect`, `resolveSigner`, and
  the free functions so behavior between the two paths can't drift — the
  facade is a composition, not a rewrite.
- **Pruning:** whenever a free function has zero in-repo callers that aren't
  the facade itself, deprecate it (JSDoc `@deprecated` pointing at the SDK
  method) and remove it after one major release.

## Deprecation rules

- `connect` stays. The SDK itself uses it, and external power users may still
  want the raw client for contract methods the SDK doesn't cover yet. It is
  not considered "threading" if it never leaves the file that connects.
- Free functions (`createCircle`, `fund`, `claim`, `getCircle`,
  `getCircleCount`, `hasClaimed`) are **not** deprecated yet — in-repo
  consumers were migrated in this change, but external consumers exist.
  Deprecation starts when the SDK covers 100% of the surface and the
  "prune after one major" clock starts via the JUMP plan above.
- Proving / identity free functions (`generateProof`, `generateIdentity`,
  `computeExternalNullifier`, `MerkleTree`, ...) are deliberately *not*
  folded into the SDK: they are stateless and don't touch the contract
  boundary. The SDK is for blockchain interaction, not proof math.

## Consequences

- Consumers hold one typed handle (`ShariboSDK`) instead of a raw untyped
  client + free functions.
- Retry policy is configured once per SDK instance, not per call.
- The `contract.ts` free functions shrink back toward thin wrappers that the
  SDK composes; caller code that threads a client disappears from in-repo
  consumers.
- One release of grace for external callers of the free functions, after
  which the JUMP/pruning rules apply.
