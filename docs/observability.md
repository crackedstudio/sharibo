# SDK observability events

The `@sharibo/client` package emits structured events so retries, RPC failures,
and proof progress are not silent. Pass `onEvent` on
[`ShariboNetworkConfig`](../packages/client/src/contract.ts) (via `connect`) and
on [`ProveOptions`](../packages/client/src/prove.ts) (via `generateProof`).

The TypeScript source of truth is the exported `SdkEvent` discriminated union in
[`packages/client/src/events.ts`](../packages/client/src/events.ts). Switch on
`event.type` exhaustively.

## Event taxonomy

| `type`              | Payload                          | When it fires                                                              |
| ------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| `rpc:attempt`       | —                                | Before each simulation/preparation attempt inside `withRetry`.             |
| `rpc:retry`         | `attempt`, `delay` (ms), `error` | A transient RPC failure (429/5xx/timeout/…) will be retried after `delay`. |
| `rpc:success`       | `duration` (ms)                  | Simulation/preparation succeeded (includes prior retries).                 |
| `rpc:failure`       | `attempt`, `error`               | Retries exhausted or a non-transient error — about to throw.               |
| `tx:submitted`      | `hash`                           | After `signAndSend` returns a submission hash.                             |
| `tx:confirmed`      | `hash`                           | When the SDK sees a confirmation response for that submission.             |
| `proof:started`     | —                                | Immediately before snarkjs `fullProve` / witness work begins.              |
| `proof:finished`    | —                                | After proof generation completes successfully.                             |
| `artifact:started`  | —                                | Circuit artifact download (wasm/zkey) begins.                              |
| `artifact:progress` | `loaded`, `total`, `fraction`    | Bytes downloaded during prefetch (optional; may be coalesced by UIs).      |
| `artifact:ready`    | `loaded`, `total`                | Both artifacts are in memory.                                              |
| `artifact:error`    | `message`                        | Prefetch failed (not an intentional abort).                                |

Artifact events are produced by the prefetch pipeline
([`artifacts.ts`](../packages/client/src/artifacts.ts)). The demo app bridges them
into the same log via `useSdkEvents()`.

## Consumer guidance

- Keep a **bounded** ring buffer (the demo uses 100 entries). An unbounded array
  fed by retries on a long session is a memory leak.
- Redact before shipping to a bug report: event payloads can carry error text or
  addresses. The app debug bundle runs every field through `findLeakedSecret`.
- Do not retry on `tx:*` yourself — submission is intentionally non-retried by
  the SDK (see package README §Retry Semantics).
