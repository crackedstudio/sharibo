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
  // { retryPolicy: { maxRetries: 5, baseDelayMs: 250 } } // optional
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

## Public API

The public surface is small and explicit. `index.ts` re-exports exactly the
values and types below, and a test (`src/index.test.ts`) asserts that this list
and the barrel agree in both directions. Internal-only symbols (field constants
like `FR_MODULUS`, the circuit-artifact prefetch machinery) live behind the
`./internal` subpath and are **not** part of the public API — importing them is
an explicit opt-in.

### Values

```ts
// Identity
generateIdentity
poseidon
randomFieldElement
computeExternalNullifier
computeNullifierHash

// Merkle tree
MerkleTree
ZERO_VALUE
TREE_LEVELS
MAX_CIRCLE_SIZE

// Proving
generateProof
verificationKeyToContractFormat
validateCircuitInput
verifyProofLocally
estimateClaimFee

// Contract client
connect
createCircle
fund
claim
getCircle
getCircleCount
getRound
getPot
getStatus
getContributors
hasClaimed
cancelCircle
explorerTxUrl

// Errors
ShariboError
InvalidInputError
ProvingError
RpcError
ContractError
```

### Types

```ts
Identity
MerkleProof
CircuitInput
ContractProof
ContractVerificationKey
GenerateProofResult
ProofResult
ShariboNetworkConfig
ShariboClient
ShariboSigner
FeeEstimate
TxResult
CircleView
```

### Internal subpath

`@sharibo/client/internal` exposes non-public helpers for deep integration work
(see `src/internal.ts`). It imports nothing eagerly into the main entrypoint, so
`ArtifactPrefetchProgress` and `FR_MODULUS` no longer reach plain consumers.

## Requirements

- **Node ≥ 20** (the repo's `.nvmrc` pins Node 20; older versions are untested)
- **Web Crypto API** — `globalThis.crypto` must be available. Node 18+ exposes this
  as a built-in global; browsers have had it for years. No polyfill is needed.

## Node vs browser entry points

The package ships a conditional `exports` map:

| Condition | Entry point | Side effects |
|-----------|-------------|--------------|
| `browser` | `src/index.browser.ts` | Mounts the "Preparing prover…" DOM toast; starts background artifact pre-fetch |
| `default` (Node, tests) | `src/index.ts` | None — safe to import in scripts, tests, and CI |

Bundlers that honour the `browser` exports condition (Vite, webpack) resolve to the
browser entry automatically. Node and test runners get the side-effect-free default.

If you need the background pre-fetch in a browser app that imports the package
directly (without a bundler resolving the `browser` condition), call
`prefetchMembershipArtifacts()` explicitly after import. The progress UI lives
in the app and subscribes via `subscribeToArtifactPrefetch()`.

## Retry Semantics

Network requests in the Soroban testnet environment can occasionally fail due to rate limits or transient load (e.g. `429 Too Many Requests`, `503 Service Unavailable`, or timeouts).

The SDK automatically handles these transient failures:
- **Simulation Phase:** Contract calls (e.g. `createCircle`, `fund`, `claim`, `getCircle`) will retry simulation/preparation steps automatically with exponential backoff.
- **Submit Phase:** Once a transaction is signed and submitted to the network (`signAndSend`), no further automatic retries are attempted. This ensures safety against double-spend or replay issues. A failure during submission or polling will surface immediately to the caller, as the state of the transaction is ambiguous.

Override the policy per SDK instance with the `retryPolicy` option:
`{ maxRetries, baseDelayMs }` (see `src/retry.ts`).
