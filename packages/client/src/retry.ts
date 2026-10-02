import type { SdkEventEmitter } from "./events.js";

/**
 * Retry policy for the client SDK.
 *
 * Soroban testnet RPC calls can fail transiently (429/503/timeouts during the
 * simulate phase), so contract-call preparation is retried with exponential
 * backoff and jitter. Submission (`signAndSend`) is intentionally NOT retried:
 * once a transaction is signed and submitted the state of the transaction is
 * ambiguous, and a retry could double-spend or replay.
 *
 * **Retryable errors:** HTTP 429/500/502/503/504, timeouts, connection resets,
 * and fetch failures (matched on the error message). Deterministic contract
 * errors (`ContractError`) are never retryable — retrying them burns fees.
 *
 * **Worst-case wait** for a policy is approximately:
 * `baseDelayMs * (2^maxRetries - 1)` (upper bound of the jittered geometric
 * series, when every retry draws the maximum 1.0× jitter factor). For
 * {@link DEFAULT_RETRY_POLICY} that is `500 * (8 - 1) = 3500ms` of sleep,
 * plus the time spent on the failed attempts themselves.
 */

export interface RetryPolicy {
  /**
   * Maximum number of *retries* after the first attempt fails.
   * Total attempts = `maxRetries + 1`.
   */
  maxRetries: number;
  /**
   * Base delay for the first retry, in milliseconds.
   * Subsequent delays double per attempt: `baseDelayMs * 2^(attempt-1) * jitter`,
   * where jitter is uniform in `[0.5, 1.0]`.
   */
  baseDelayMs: number;
}

/**
 * Default policy for most SDK calls.
 *
 * - 3 retries (4 total attempts)
 * - 500ms base delay, doubling each retry, with 50–100% jitter
 * - Worst-case sleep budget: ~3.5s (see module docs)
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 500,
};

/**
 * Fast policy for UI polling loops. One quick retry is enough — the next
 * poll cycle will try again if the transient failure persists. Retrying a
 * poll for tens of seconds is worse than letting the next tick handle it.
 *
 * Worst-case sleep: ~250ms.
 */
export const POLL_RETRY_POLICY: RetryPolicy = {
  maxRetries: 1,
  baseDelayMs: 250,
};

/**
 * Patient policy for claim (and similar one-shot costly writes). A 429 here
 * costs the user a regenerated proof, so patience is warranted.
 *
 * - 5 retries (6 total attempts)
 * - 750ms base delay
 * - Worst-case sleep: `750 * (32 - 1) ≈ 23.25s`
 */
export const PATIENT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 5,
  baseDelayMs: 750,
};

/**
 * Computes the backoff delay for a given 1-based retry attempt.
 * Exported for unit tests; production callers go through {@link withRetry}.
 */
export function computeDelay(policy: RetryPolicy, attempt: number, random = Math.random): number {
  const jitter = 0.5 + random() * 0.5;
  return policy.baseDelayMs * 2 ** (attempt - 1) * jitter;
}

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
 *
 * Emits `rpc:attempt`, `rpc:retry`, and `rpc:success` on `emitter` when provided
 * so a retry storm is visible to observability subscribers.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  emitter?: SdkEventEmitter,
): Promise<T> {
  let attempt = 0;
  const startedAt = Date.now();
  while (true) {
    try {
      emitter?.emit({ type: "rpc:attempt" });
      const result = await fn();
      emitter?.emit({ type: "rpc:success", duration: Date.now() - startedAt });
      return result;
    } catch (error) {
      if (!isTransientError(error) || attempt >= policy.maxRetries) {
        emitter?.emit({ type: "rpc:failure", attempt, error });
        throw error;
      }
      attempt++;
      const delay = computeDelay(policy, attempt);
      emitter?.emit({ type: "rpc:retry", attempt, delay, error });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
