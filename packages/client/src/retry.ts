/**
 * Retry policy for the client SDK.
 *
 * Soroban testnet RPC calls can fail transiently (429/5xx/timeouts during the
 * simulate phase), so contract-call preparation is retried with exponential
 * backoff. Submission (`signAndSend`) is intentionally NOT retried: once a
 * transaction is signed and submitted the state of the transaction is
 * ambiguous, and a retry could double-spend or replay. `withRetry` therefore
 * only wraps simulation/preparation steps, never a signed submission.
 */

export interface RetryPolicy {
  /** Maximum number of invocations of the wrapped step (1 = never retry). */
  attempts: number;
  /** Delay before the first retry, in ms. Doubles per retry after that. */
  baseDelayMs: number;
  /** Upper bound for any single backoff delay, in ms. */
  maxDelayMs: number;
  /** Full jitter: a retry delay is drawn uniformly from [0, capped] when true. */
  jitter: boolean;
  /** Decides whether a thrown error is worth retrying. */
  isRetryable(e: unknown): boolean;
  /**
   * Asynchronous sleep used between retries. Injectable so tests can use a
   * fake clock instead of sleeping for real. Defaults to a real `setTimeout`.
   */
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultIsRetryable(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("429") ||
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("timeout") ||
    message.includes("connection reset") ||
    message.includes("fetch failed")
  );
}

/**
 * The default policy: 3 attempts, exponential backoff from 250ms capped at
 * 4s, full jitter. Override per instance via `ShariboSDK.connect`'s
 * `retryPolicy` option or per call by passing a policy to the free functions.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4000,
  jitter: true,
  isRetryable: defaultIsRetryable,
  sleep: defaultSleep,
};

function backoffDelay(retry: number, policy: RetryPolicy): number {
  const capped = Math.min(policy.baseDelayMs * 2 ** retry, policy.maxDelayMs);
  return policy.jitter ? Math.random() * capped : capped;
}

/**
 * Runs `fn` (a simulation/preparation step) up to `policy.attempts` times,
 * sleeping between attempts when the failure is retryable. Non-retryable
 * errors and exhausted retry budgets surface immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<T> {
  const sleep = policy.sleep ?? defaultSleep;
  let attempted = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (attempted + 1 >= policy.attempts || !policy.isRetryable(error)) throw error;
      await sleep(backoffDelay(attempted, policy));
      attempted++;
    }
  }
}