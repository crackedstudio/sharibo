export class FriendbotRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FriendbotRetryableError";
  }
}

// Exported so App.tsx can pass it through t() — the rate-limit message is
// surfaced via toUiError rather than a locale key because it comes from the
// friendbot service (external), not from UI copy. If you want it translated,
// add "error.friendbotRateLimit" to the locale files and pass t() in here.
export const FRIEND_BOT_RATE_LIMIT_MESSAGE =
  "Friendbot rate-limited this request. Wait a few seconds and try again.";

export async function friendbotFund(publicKey: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  if (res.status === 429) {
    throw new FriendbotRetryableError(FRIEND_BOT_RATE_LIMIT_MESSAGE);
  }
  if (!res.ok && res.status !== 400) {
    throw new Error(`friendbot funding failed: ${res.status}`);
  }
}
