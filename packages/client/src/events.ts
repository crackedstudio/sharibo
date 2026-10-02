/**
 * Observability events emitted by the Sharibo client SDK.
 *
 * Consumers pass an `onEvent` callback via {@link ShariboNetworkConfig} /
 * {@link ProveOptions} (or subscribe to artifact prefetch and bridge into the
 * same handler) to surface retries, RPC failures, proof progress, and
 * transaction lifecycle without polling.
 *
 * Full taxonomy: {@link docs/observability.md} (repo root `docs/`) and the
 * "Observability" section of this package's README.
 */

/** Discriminated union of every event the SDK can emit. Switch exhaustively. */
export type SdkEvent =
  | { type: "rpc:attempt" }
  | { type: "rpc:retry"; attempt: number; delay: number; error: unknown }
  | { type: "rpc:success"; duration: number }
  | { type: "rpc:failure"; attempt: number; error: unknown }
  | { type: "tx:submitted"; hash: string }
  | { type: "tx:confirmed"; hash: string }
  | { type: "proof:started" }
  | { type: "proof:finished" }
  | { type: "artifact:started" }
  | { type: "artifact:progress"; loaded: number; total: number | null; fraction: number | null }
  | { type: "artifact:ready"; loaded: number; total: number }
  | { type: "artifact:error"; message: string };

export type OnEventFn = (event: SdkEvent) => void;

export class SdkEventEmitter {
  constructor(private onEvent?: OnEventFn) {}

  emit(event: SdkEvent) {
    if (this.onEvent) {
      this.onEvent(event);
    }
  }
}
