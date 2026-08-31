# Sharibo Client SDK

This package provides a TypeScript SDK for interacting with the Sharibo
contract on Stellar/Soroban.

The primary interface is **`ShariboSDK`** — a facade that binds a network, a
signer, and a retry policy once, so callers never have to thread a raw
contract client through their code (see `docs/adr/003-client-boundary.md`).

## Quick start

```ts
import { ShariboSDK } from "@sharibo/client";
import { Keypair } from "@stellar/stellar-sdk";

const sdk = await ShariboSDK.connect(
  {
    contractId: "…",                       // C… 56-char contract id
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
  Keypair.random(),                        // or a wallet-style signer
  // { retryPolicy: { attempts: 5, baseDelayMs: 250, maxDelayMs: 4000, jitter: true } } // optional
);

// Create a circle.
const { result: circleId, hash } = await sdk.createCircle({
  admin: sdk.publicKey,
  token: "…",
  root: treeRoot,
  contribution: 10_000_000n,
  size: 5,
  vk,
});

// Fund it (from any member's own SDK instance).
await sdk.fund({ circleId, from: memberPublicKey });

// Read state.
const circle = await sdk.getCircle(circleId);
const alreadyClaimed = await sdk.hasClaimed(circleId, nullifierHash);

// Claim the pot with a Groth16 proof.
await sdk.claim({
  circleId,
  recipient: freshRecipient,
  nullifierHash,
  externalNullifier,
  proof,
});
```

Signing a claim still needs a ZK proof. Proving and identity math are separate
**stateless** free functions on the same package — the SDK is for contract
interaction only:

```ts
import { generateIdentity, MerkleTree, generateProof, computeExternalNullifier } from "@sharibo/client";

const identity = generateIdentity();
const tree = MerkleTree.create(4, commitments);
const externalNullifier = await computeExternalNullifier(circleId, 0n);
const { proof, nullifierHash } = await generateProof(input, wasmPath, zkeyPath);
```

## Free functions (escape hatch, not the default)

The SDK is built on a set of free functions (`createCircle`, `fund`, `claim`,
`getCircle`, `getCircleCount`, `hasClaimed`) that take a raw client, plus
`connect(config, signer)` which builds that client. They remain exported so
existing callers and power users can reach past the facade, but **new code
should use `ShariboSDK`** — the free functions are scheduled for deprecation
once the SDK covers 100% of their surface (see the JUMP plan in
`docs/adr/003-client-boundary.md`).

## Retry Semantics

Network requests in the Soroban testnet environment can occasionally fail due to rate limits or transient load (e.g. `429 Too Many Requests`, `503 Service Unavailable`, or timeouts).

The SDK automatically handles these transient failures:
- **Simulation Phase:** Contract calls (e.g. `createCircle`, `fund`, `claim`, `getCircle`) will retry simulation/preparation steps automatically with exponential backoff.
- **Submit Phase:** Once a transaction is signed and submitted to the network (`signAndSend`), no further automatic retries are attempted. This ensures safety against double-spend or replay issues. A failure during submission or polling will surface immediately to the caller, as the state of the transaction is ambiguous.

**Defaults** (`DEFAULT_RETRY_POLICY` in `src/retry.ts`):

| Option | Default | Meaning |
| --- | --- | --- |
| `attempts` | `3` | Maximum invocations of the retried step (1 = never retry) |
| `baseDelayMs` | `250` | Delay before the first retry; doubles per retry after |
| `maxDelayMs` | `4000` | Upper bound for any single backoff delay |
| `jitter` | `true` | Full jitter — each delay is drawn from `[0, capped)` |
| `isRetryable` | 429 / 500–504 / timeout / connection reset / fetch failed | Decides whether a thrown error is worth retrying |
| `sleep` | real `setTimeout` | Injectable async sleep for tests (fake clock) |

Override the policy per SDK instance with the `retryPolicy` option:
`{ attempts, baseDelayMs, maxDelayMs, jitter, isRetryable, sleep? }` (see `src/retry.ts`).