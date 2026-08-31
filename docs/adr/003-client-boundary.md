# ADR 003: The `@sharibo/client` boundary — `ShariboSDK` facade first

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