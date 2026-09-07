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

export async function friendbotFund(publicKey: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  // 400 means "already funded", which is a success for our purposes.
  if (res.ok || res.status === 400) return;
  if (res.status === 429 || res.status >= 500) {
    throw new FriendbotRetryableError(FRIEND_BOT_RATE_LIMIT_MESSAGE, res.status);
  }
  throw new Error(`friendbot funding failed: ${res.status}`);
}
