/**
 * Retry policy for the client SDK.
 *
 * Soroban testnet RPC calls can fail transiently (429/503/timeouts during the
 * simulate phase), so contract-call preparation is retried with exponential
 * backoff and jitter. Submission (`signAndSend`) is intentionally NOT retried:
 * once a transaction is signed and submitted the state of the transaction is
 * ambiguous, and a retry could double-spend or replay.
 */

export interface RetryPolicy {
  /** Max automatic retries of the simulation/preparation phase. */
  maxRetries: number;
  /** Base delay for the first retry, in ms. Doubles per attempt with jitter. */
  baseDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 500,
};

function isTransientError(error: unknown): boolean {
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
 * Runs `fn` (a simulation/preparation step) with exponential backoff + jitter
 * on transient failures. Non-transient errors and errors past the policy's
 * retry budget surface immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (!isTransientError(error) || attempt >= policy.maxRetries) throw error;
      attempt++;
      const jitter = 0.5 + Math.random() * 0.5;
      const delay = policy.baseDelayMs * 2 ** (attempt - 1) * jitter;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}