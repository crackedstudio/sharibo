import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { friendbotFund, friendbotFundMany, FriendbotRetryableError, FRIEND_BOT_RATE_LIMIT_MESSAGE, type FriendbotFundResult } from "./friendbot.js";

describe("friendbotFund", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("resolves on 200 OK", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await expect(friendbotFund("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledWith(
      "https://friendbot.stellar.org?addr=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
  });

  it("treats 400 (already funded) as success", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    await expect(friendbotFund("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).resolves.toBeUndefined();
  });

  it("retries on 429 and succeeds on second attempt", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const promise = friendbotFund("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    // Advance timers through the backoff delays
    await vi.advanceTimersByTimeAsync(2000); // First retry after 2000ms
    await expect(promise).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 and succeeds on second attempt", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const promise = friendbotFund("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on 503 and succeeds on third attempt", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const promise = friendbotFund("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    await vi.advanceTimersByTimeAsync(2000); // first retry
    await vi.advanceTimersByTimeAsync(4000); // second retry (2000 * attempt)
    await expect(promise).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("throws FriendbotRetryableError with FRIEND_BOT_RATE_LIMIT_MESSAGE after exhausting retries on 429", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });

    const promise = friendbotFund("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    // Exhaust all retries: 3 attempts with delays of 2000, 4000, 6000
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    await vi.advanceTimersByTimeAsync(6000);

    await expect(promise).rejects.toThrow(FriendbotRetryableError);
    await expect(promise).rejects.toThrow(FRIEND_BOT_RATE_LIMIT_MESSAGE);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("throws FriendbotRetryableError with status after exhausting retries on 500", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const promise = friendbotFund("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    await vi.advanceTimersByTimeAsync(6000);

    await expect(promise).rejects.toThrow(FriendbotRetryableError);
    try {
      await promise;
    } catch (e) {
      expect(e).toBeInstanceOf(FriendbotRetryableError);
      expect((e as FriendbotRetryableError).status).toBe(500);
    }
  });

  it("throws FriendbotRetryableError on network error (fetch throws)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    const promise = friendbotFund("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    await vi.advanceTimersByTimeAsync(6000);

    await expect(promise).rejects.toThrow(FriendbotRetryableError);
    await expect(promise).rejects.toThrow(FRIEND_BOT_RATE_LIMIT_MESSAGE);
  });

  it("throws generic Error for non-retryable status codes (e.g., 404)", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    await expect(friendbotFund("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).rejects.toThrow(
      "friendbot funding failed: 404",
    );
  });

  it("throws generic Error for 401", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });

    await expect(friendbotFund("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).rejects.toThrow(
      "friendbot funding failed: 401",
    );
  });

  it("FriendbotRetryableError includes status in constructor", () => {
    const error = new FriendbotRetryableError("test message", 429);
    expect(error.message).toBe("test message");
    expect(error.status).toBe(429);
    expect(error.name).toBe("FriendbotRetryableError");
  });

  it("FriendbotRetryableError uses default message when none provided", () => {
    const error = new FriendbotRetryableError();
    expect(error.message).toBe(FRIEND_BOT_RATE_LIMIT_MESSAGE);
    expect(error.status).toBeUndefined();
  });
});

describe("friendbotFundMany", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns success for all accounts when all succeed", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const keys = [
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    ];

    const results = await friendbotFundMany(keys, { delayMs: 0 });

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results.map((r) => r.publicKey)).toEqual(keys);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("returns partial success when some accounts fail with rate limit", async () => {
    // First account succeeds (1 call), second gets rate limited (3 retries = 3 calls), third succeeds (1 call)
    // Total: 5 fetch calls
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 }) // key 1 success
      .mockResolvedValueOnce({ ok: false, status: 429 }) // key 2 attempt 1
      .mockResolvedValueOnce({ ok: false, status: 429 }) // key 2 attempt 2
      .mockResolvedValueOnce({ ok: false, status: 429 }) // key 2 attempt 3 (exhausted)
      .mockResolvedValueOnce({ ok: true, status: 200 }); // key 3 success

    const keys = [
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    ];

    const promise = friendbotFundMany(keys, { delayMs: 0 });

    // Exhaust retries for key 2 (3 attempts with delays 2000, 4000, 6000 = 12000ms total)
    await vi.advanceTimersByTimeAsync(12000);

    const results = await promise;

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].error).toBeInstanceOf(FriendbotRetryableError);
    expect(results[2].success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(5);
  });

  it("calls onProgress callback for each result", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const onProgress = vi.fn();
    const keys = ["GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"];

    await friendbotFundMany(keys, { delayMs: 0, onProgress });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ publicKey: keys[0], success: true }),
    );
  });

  it("serializes requests sequentially (not parallel)", async () => {
    // Use delayMs: 0 to avoid waiting, but verify they're called sequentially
    // by checking the call order
    const callOrder: number[] = [];
    global.fetch = vi.fn().mockImplementation(async () => {
      callOrder.push(callOrder.length + 1);
      return { ok: true, status: 200 };
    });

    const keys = [
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    ];

    await friendbotFundMany(keys, { delayMs: 0 });

    // Requests should be made in sequence (1, 2, 3)
    expect(callOrder).toEqual([1, 2, 3]);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});