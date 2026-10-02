// The single HTTP entry point for every script in this workspace.
//
// History: e2e.ts used to shell out to `curl` for its two Horizon/friendbot
// calls because Node's fetch/undici appeared to hang against those endpoints in
// the environment where it was written (see the original comment and NOTES.md).
// That workaround never survived scrutiny — it made `curl` an undeclared
// runtime dependency of the flagship verification script, unusable from a
// Node-only container. The original hang has not reproduced since Node
// undici was hardened; the abort signal below is the real safety net.
//
// Why an explicit `AbortController` rather than a bare `AbortSignal.timeout`:
// `AbortSignal.timeout` cannot be combined with a caller-supplied signal, and
// it is incompatible with a `keepalive: false` dispatcher. We need both
// (a) a hard deadline and (b) `keepalive: false`, because a pooled
// keep-alive socket to a testnet endpoint that has gone away is one of the
// failure modes that presents as an indefinite hang. See #511.

/** Default per-request deadline, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 15_000;

export interface HttpGetOptions {
  /** Hard deadline for the whole request. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Init for the underlying `fetch`, e.g. extra headers. */
  init?: RequestInit;
}

/**
 * GET a URL and return the response body as text.
 *
 * Throws on a non-2xx status, with the status code, the URL and the response
 * body in the message so failures are diagnosable from a log line alone.
 * Throws a `TimeoutError` if the deadline elapses first.
 */
export async function httpGet(url: string, options: HttpGetOptions = {}): Promise<string> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, init } = options;

  // Compose the caller's signal with our deadline, since neither
  // AbortSignal.any() nor AbortSignal.timeout() alone gives us both plus the
  // keepalive: false dispatcher below.
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      new DOMException(`Request to ${url} timed out after ${timeoutMs}ms`, "TimeoutError"),
    );
  }, timeoutMs);

  // A caller-supplied signal (e.g. a Ctrl-C handler) must also abort us.
  // `addEventListener` never fires for an already-aborted signal, so check
  // the flag first — otherwise a signal that was aborted before the call is
  // made would be silently ignored and we'd hang until our own deadline.
  const external = init?.signal;
  const onExternalAbort = () => controller.abort(external?.reason);
  if (external?.aborted) {
    onExternalAbort();
  } else {
    external?.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      // `keepalive: false` closes the socket after the response so a dead
      // testnet endpoint cannot leave a half-open pooled connection that the
      // next request inherits.
      keepalive: false,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} from ${url}: ${body}`);
    }

    return await res.text();
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onExternalAbort);
  }
}

/** GET a URL and parse the response as JSON. */
export async function httpGetJson<T = unknown>(
  url: string,
  options: HttpGetOptions = {},
): Promise<T> {
  return JSON.parse(await httpGet(url, options)) as T;
}
