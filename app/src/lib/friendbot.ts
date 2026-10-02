/** Message shown when Friendbot rate-limits a funding request. */
export const FRIEND_BOT_RATE_LIMIT_MESSAGE =
  "Friendbot is rate-limiting testnet funding right now. Wait a moment and retry.";

/**
 * Friendbot refused for a reason that is worth retrying (rate limit or a
 * transient server error), as opposed to a permanent failure.
 */
export class FriendbotRetryableError extends Error {
  constructor(
    message = FRIEND_BOT_RATE_LIMIT_MESSAGE,
    readonly status?: number,
  ) {
    super(message);
    this.name = "FriendbotRetryableError";
  }
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function friendbotFund(publicKey: string): Promise<void> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
      // 400 means "already funded", which is a success for our purposes.
      if (res.ok || res.status === 400) return;
      if (res.status === 429 || res.status >= 500) {
        lastError = new FriendbotRetryableError(FRIEND_BOT_RATE_LIMIT_MESSAGE, res.status);
        // Don't throw on the last attempt - let the loop exhaust
        if (attempt === MAX_RETRIES) break;
        // Exponential backoff: 2000ms, 4000ms, 6000ms...
        await sleep(BASE_DELAY_MS * attempt);
        continue;
      }
      throw new Error(`friendbot funding failed: ${res.status}`);
    } catch (e) {
      // Network errors (fetch throws) are retryable
      if (e instanceof TypeError && /fetch|network|timeout|abort/i.test(e.message)) {
        lastError = new FriendbotRetryableError(FRIEND_BOT_RATE_LIMIT_MESSAGE);
        if (attempt === MAX_RETRIES) break;
        await sleep(BASE_DELAY_MS * attempt);
        continue;
      }
      // Non-retryable errors - throw immediately
      throw e;
    }
  }

  // All retries exhausted
  throw lastError ?? new FriendbotRetryableError(FRIEND_BOT_RATE_LIMIT_MESSAGE);
}

/** Result of funding a single account via friendbot. */
export interface FriendbotFundResult {
  publicKey: string;
  success: boolean;
  error?: FriendbotRetryableError;
}

/**
 * Fund multiple accounts via friendbot, returning per-account results.
 * This allows partial success — if some accounts are rate-limited, others
 * can still succeed and the caller can retry just the failed ones.
 *
 * Calls are serialized with a small delay to reduce the chance of hitting
 * the rate limit in the first place.
 */
export async function friendbotFundMany(
  publicKeys: string[],
  options?: { delayMs?: number; onProgress?: (result: FriendbotFundResult) => void },
): Promise<FriendbotFundResult[]> {
  const delayMs = options?.delayMs ?? 500;
  const results: FriendbotFundResult[] = [];

  for (const publicKey of publicKeys) {
    try {
      await friendbotFund(publicKey);
      const result = { publicKey, success: true };
      results.push(result);
      options?.onProgress?.(result);
    } catch (e) {
      const error =
        e instanceof FriendbotRetryableError ? e : new FriendbotRetryableError(String(e));
      const result = { publicKey, success: false, error };
      results.push(result);
      options?.onProgress?.(result);
    }
    // Small delay between requests to avoid hammering the faucet
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return results;
}
