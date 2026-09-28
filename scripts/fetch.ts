/**
 * fetch() with a timeout that is safe to leave behind at process exit.
 *
 * Why not `AbortSignal.timeout()`: its internal timer stays pending for the
 * full duration even after the fetch settles. If the process calls
 * `process.exit()` while such a timer is pending, Node's Windows teardown
 * races libuv handle closing and aborts with
 * `STATUS_STACK_BUFFER_OVERRUN` (exit code 3221226505) — masking the real
 * exit code. A manual AbortController + unref'd timer cleared in `finally`
 * has identical timeout semantics with no teardown hazard on any platform.
 */
export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Don't hold the event loop open for the timeout alone.
  (timer as unknown as { unref?: () => void }).unref?.();
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
