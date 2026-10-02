import type { OnEventFn } from "./events.js";

export const MEMBERSHIP_WASM_URL = "/circuits/membership.wasm";
export const MEMBERSHIP_ZKEY_URL = "/circuits/membership_final.zkey";

export interface ArtifactsConfig {
  wasmUrl?: string;
  zkeyUrl?: string;
  fetchImpl?:
    typeof fetch | ((input: string | URL | Request, init?: RequestInit) => Promise<Response>);
  /** Optional observability hook; also receives artifact:* SdkEvents. */
  onEvent?: OnEventFn;
}

let configuredWasmUrl = MEMBERSHIP_WASM_URL;
let configuredZkeyUrl = MEMBERSHIP_ZKEY_URL;
let configuredFetchImpl:
  | typeof fetch
  | ((input: string | URL | Request, init?: RequestInit) => Promise<Response>)
  | undefined;
let configuredOnEvent: OnEventFn | undefined;

export type ArtifactPrefetchStatus = "idle" | "loading" | "ready" | "error";

export interface ArtifactPrefetchProgress {
  status: ArtifactPrefetchStatus;
  loaded: number;
  total: number | null;
  fraction: number | null;
  error?: Error;
}

export interface ProverArtifacts {
  wasm: Uint8Array;
  zkey: Uint8Array;
}

type Listener = (progress: ArtifactPrefetchProgress) => void;

let prefetchPromise: Promise<ProverArtifacts> | undefined;
let currentProgress: ArtifactPrefetchProgress = {
  status: "idle",
  loaded: 0,
  total: null,
  fraction: null,
};
const listeners = new Set<Listener>();
/** Last status we emitted as an SdkEvent, to avoid flooding on byte progress. */
let lastEmittedStatus: ArtifactPrefetchStatus | "idle" = "idle";
/**
 * Configures the circuit artifact locations and optional custom fetch implementation.
 *
 * @param config - Configuration options for artifact URLs and fetch implementation.
 */
export function configureArtifacts(config: ArtifactsConfig): void {
  if (config.wasmUrl !== undefined) {
    configuredWasmUrl = config.wasmUrl;
  }
  if (config.zkeyUrl !== undefined) {
    configuredZkeyUrl = config.zkeyUrl;
  }
  if (config.fetchImpl !== undefined) {
    configuredFetchImpl = config.fetchImpl;
  }
  if (config.onEvent !== undefined) {
    configuredOnEvent = config.onEvent;
  }
  prefetchPromise = undefined;
  lastEmittedStatus = "idle";
  publish({
    status: "idle",
    loaded: 0,
    total: null,
    fraction: null,
  });
}

/** Register (or clear) the SdkEvent sink for artifact prefetch without resetting cache. */
export function setArtifactOnEvent(onEvent?: OnEventFn): void {
  configuredOnEvent = onEvent;
}
/**
 * Returns the currently active artifact configuration.
 */
export function getArtifactsConfig(): {
  wasmUrl: string;
  zkeyUrl: string;
  fetchImpl?:
    typeof fetch | ((input: string | URL | Request, init?: RequestInit) => Promise<Response>);
} {
  return {
    wasmUrl: configuredWasmUrl,
    zkeyUrl: configuredZkeyUrl,
    fetchImpl: configuredFetchImpl,
  };
}

/**
 * Resets artifact configuration and prefetch state back to initial defaults.
 */
export function resetArtifactsConfig(): void {
  configuredWasmUrl = MEMBERSHIP_WASM_URL;
  configuredZkeyUrl = MEMBERSHIP_ZKEY_URL;
  configuredFetchImpl = undefined;
  configuredOnEvent = undefined;
  prefetchPromise = undefined;
  lastEmittedStatus = "idle";
  publish({
    status: "idle",
    loaded: 0,
    total: null,
    fraction: null,
  });
}

function publish(progress: ArtifactPrefetchProgress): void {
  currentProgress = progress;
  for (const listener of listeners) {
    listener(progress);
  }
  emitArtifactSdkEvent(progress);
}

function emitArtifactSdkEvent(progress: ArtifactPrefetchProgress): void {
  if (!configuredOnEvent) return;
  if (progress.status === "loading" && lastEmittedStatus !== "loading") {
    lastEmittedStatus = "loading";
    configuredOnEvent({ type: "artifact:started" });
    return;
  }
  if (progress.status === "ready" && lastEmittedStatus !== "ready") {
    lastEmittedStatus = "ready";
    configuredOnEvent({
      type: "artifact:ready",
      loaded: progress.loaded,
      total: progress.total ?? progress.loaded,
    });
    return;
  }
  if (progress.status === "error" && lastEmittedStatus !== "error") {
    lastEmittedStatus = "error";
    configuredOnEvent({
      type: "artifact:error",
      message: progress.error?.message ?? "Unable to download circuit artifact",
    });
    return;
  }
  if (progress.status === "idle") {
    lastEmittedStatus = "idle";
  }
}
async function readResponse(
  response: Response,
  onProgress: (loaded: number, total: number | null) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!response.ok) {
    throw new Error(`Unable to download circuit artifact (${response.status})`);
  }

  const contentLengthHeader = response.headers?.get?.("content-length");
  const total = contentLengthHeader ? Number(contentLengthHeader) : null;
  const reader =
    typeof response.body?.getReader === "function" ? response.body.getReader() : undefined;

  if (!reader) {
    signal?.throwIfAborted();
    const buffer = new Uint8Array(await response.arrayBuffer());
    onProgress(buffer.byteLength, total ?? buffer.byteLength);
    return buffer;
  }

  const chunks: Uint8Array[] = [];
  let loaded = 0;

  // If the signal fires while we are blocked on reader.read(), cancel the
  // underlying stream so the read() promise rejects, then re-throw as
  // AbortError for uniform error handling.
  const abortHandler = () => reader.cancel();
  signal?.addEventListener("abort", abortHandler);

  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        onProgress(loaded, total);
      }
    }
  } catch (err) {
    // reader.cancel() (triggered by the abort handler above) causes read() to
    // throw — convert that back to a recognisable AbortError.
    if (signal?.aborted) {
      throw new DOMException("Artifact download aborted", "AbortError");
    }
    throw err;
  } finally {
    signal?.removeEventListener("abort", abortHandler);
  }

  const result = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress(loaded, total ?? loaded);
  return result;
}

async function fetchArtifacts(signal?: AbortSignal): Promise<ProverArtifacts> {
  signal?.throwIfAborted();

  publish({
    status: "loading",
    loaded: 0,
    total: null,
    fraction: null,
  });

  const fetchImpl = configuredFetchImpl ?? globalThis.fetch.bind(globalThis);

  const [wasmResponse, zkeyResponse] = await Promise.all([
    fetchImpl(configuredWasmUrl, { signal }),
    fetchImpl(configuredZkeyUrl, { signal }),
  ]);

  let wasmLoaded = 0;
  let zkeyLoaded = 0;
  const wasmTotal = wasmResponse.headers?.get?.("content-length");
  const zkeyTotal = zkeyResponse.headers?.get?.("content-length");
  const knownTotal = wasmTotal && zkeyTotal ? Number(wasmTotal) + Number(zkeyTotal) : null;

  const read = async (response: Response, index: 0 | 1): Promise<Uint8Array> => {
    return readResponse(
      response,
      (value) => {
        if (index === 0) wasmLoaded = value;
        else zkeyLoaded = value;
        const currentLoaded = wasmLoaded + zkeyLoaded;
        publish({
          status: "loading",
          loaded: currentLoaded,
          total: knownTotal,
          fraction: knownTotal && knownTotal > 0 ? Math.min(currentLoaded / knownTotal, 1) : null,
        });
      },
      signal,
    );
  };

  const [wasm, zkey] = await Promise.all([read(wasmResponse, 0), read(zkeyResponse, 1)]);

  const loaded = wasm.byteLength + zkey.byteLength;
  const total = knownTotal ?? loaded;
  publish({ status: "ready", loaded, total, fraction: 1 });
  return { wasm, zkey };
}

/**
 * Explicitly start the background artifact prefetch. This is the public API
 * the app calls when it wants to warm the prover ahead of the user clicking
 * "Claim". It intentionally has no side effects at import time.
 */
export function startArtifactPrefetch(signal?: AbortSignal): Promise<ProverArtifacts> {
  return prefetchMembershipArtifacts(signal);
}

/**
 * Background prefetch — called explicitly by the app or by the proving path
 * when we need the bytes cached. The returned promise is memoised; callers
 * that only need "give me the cached bytes" should call this with no argument.
 *
 * When a signal is provided (e.g. from a React effect cleanup), a *separate*
 * signal-aware fetch is started and returned. This does NOT replace the
 * background singleton — if the background fetch already finished or is in
 * flight its result is still used by the no-signal path.
 */
export function prefetchMembershipArtifacts(signal?: AbortSignal): Promise<ProverArtifacts> {
  return getDefaultLoader().prefetch(signal);
}

/**
 * Subscribes to artifact prefetch progress updates.
 */
export function subscribeToArtifactProgress(listener: Listener): () => void {
  return getDefaultLoader().subscribe(listener);
}

export function getArtifactPrefetchProgress(): ArtifactPrefetchProgress {
  return currentProgress;
}

export function __resetForTesting(): void {
  prefetchPromise = undefined;
  currentProgress = {
    status: "idle",
    loaded: 0,
    total: null,
    fraction: null,
  };
  listeners.clear();
}

export function subscribeToArtifactPrefetch(listener: Listener): () => void {
  listeners.add(listener);
  listener(currentProgress);
  return () => listeners.delete(listener);
}
