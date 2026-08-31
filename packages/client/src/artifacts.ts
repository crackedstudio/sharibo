export const MEMBERSHIP_WASM_URL = "/circuits/membership.wasm";
export const MEMBERSHIP_ZKEY_URL = "/circuits/membership_final.zkey";

export type ArtifactPrefetchStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error";

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
let indicatorInstalled = false;

function publish(progress: ArtifactPrefetchProgress): void {
  currentProgress = progress;
  for (const listener of listeners) {
    listener(progress);
  }
  updateIndicator(progress);
}

async function readResponse(
  response: Response,
  onProgress: (loaded: number, total: number | null) => void,
): Promise<Uint8Array> {
  if (!response.ok) {
    throw new Error(`Unable to download circuit artifact (${response.status})`);
  }

  const contentLengthHeader = response.headers.get("content-length");
  const total = contentLengthHeader ? Number(contentLengthHeader) : null;
  const reader = response.body?.getReader();

  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    onProgress(buffer.byteLength, total ?? buffer.byteLength);
    return buffer;
  }

  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, total);
    }
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

async function fetchArtifacts(): Promise<ProverArtifacts> {
  publish({
    status: "loading",
    loaded: 0,
    total: null,
    fraction: null,
  });

  let loaded = 0;
  let total: number | null = null;

  const update = (artifactLoaded: number, artifactTotal: number | null) => {
    loaded += artifactLoaded;
    if (artifactTotal !== null) {
      total = (total ?? 0) + artifactTotal;
    }
    publish({
      status: "loading",
      loaded,
      total,
      fraction: total && total > 0 ? Math.min(loaded / total, 1) : null,
    });
  };

  const [wasmResponse, zkeyResponse] = await Promise.all([
    fetch(MEMBERSHIP_WASM_URL),
    fetch(MEMBERSHIP_ZKEY_URL),
  ]);

  let wasmLoaded = 0;
  let zkeyLoaded = 0;
  const wasmTotal = wasmResponse.headers.get("content-length");
  const zkeyTotal = zkeyResponse.headers.get("content-length");
  const knownTotal =
    wasmTotal && zkeyTotal ? Number(wasmTotal) + Number(zkeyTotal) : null;

  const read = async (
    response: Response,
    index: 0 | 1,
  ): Promise<Uint8Array> => {
    return readResponse(response, (value) => {
      if (index === 0) wasmLoaded = value;
      else zkeyLoaded = value;
      const currentLoaded = wasmLoaded + zkeyLoaded;
      publish({
        status: "loading",
        loaded: currentLoaded,
        total: knownTotal,
        fraction:
          knownTotal && knownTotal > 0
            ? Math.min(currentLoaded / knownTotal, 1)
            : null,
      });
    });
  };

  const [wasm, zkey] = await Promise.all([
    read(wasmResponse, 0),
    read(zkeyResponse, 1),
  ]);

  loaded = wasm.byteLength + zkey.byteLength;
  total = knownTotal ?? loaded;
  publish({ status: "ready", loaded, total, fraction: 1 });
  return { wasm, zkey };
}

export function prefetchMembershipArtifacts(): Promise<ProverArtifacts> {
  if (!prefetchPromise) {
    prefetchPromise = fetchArtifacts().catch((cause: unknown) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      publish({
        status: "error",
        loaded: currentProgress.loaded,
        total: currentProgress.total,
        fraction: currentProgress.fraction,
        error,
      });
      throw error;
    });
  }
  return prefetchPromise;
}

export function getArtifactPrefetchProgress(): ArtifactPrefetchProgress {
  return currentProgress;
}

export function subscribeToArtifactPrefetch(
  listener: Listener,
): () => void {
  listeners.add(listener);
  listener(currentProgress);
  return () => listeners.delete(listener);
}

function updateIndicator(progress: ArtifactPrefetchProgress): void {
  if (typeof document === "undefined") return;
  const element = document.getElementById("sharibo-prover-preparation");
  if (!element) return;

  if (progress.status === "ready") {
    element.remove();
    return;
  }

  element.textContent =
    progress.status === "error"
      ? "Prover preparation failed"
      : progress.fraction === null
        ? "Preparing prover…"
        : `Preparing prover… ${Math.round(progress.fraction * 100)}%`;
}

function installIndicator(): void {
  if (indicatorInstalled || typeof document === "undefined") return;
  indicatorInstalled = true;

  const add = () => {
    if (document.getElementById("sharibo-prover-preparation")) return;
    const element = document.createElement("div");
    element.id = "sharibo-prover-preparation";
    element.setAttribute("aria-live", "polite");
    element.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:1000;padding:6px 10px;border-radius:6px;background:rgba(20,25,35,.78);color:#b9c2d0;font:12px system-ui,sans-serif;pointer-events:none";
    document.body.appendChild(element);
    updateIndicator(currentProgress);
  };

  if (document.body) add();
  else document.addEventListener("DOMContentLoaded", add, { once: true });
}
// No module-load side effects here on purpose: importing this module — from
// tests, scripts, SSR, or the web app — must not start a network fetch (and
// the artifact URLs are origin-relative, so a fetch makes no sense outside a
// real browser page anyway). Call prefetchMembershipArtifacts() explicitly
// when a page actually wants to start warming the prover.
