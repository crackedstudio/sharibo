import { test } from "vitest";
import assert from "node:assert";
import { DEFAULT_RETRY_POLICY, withRetry, type RetryPolicy } from "./retry.js";

function fakeClockPolicy(overrides: Partial<RetryPolicy> = {}): { policy: RetryPolicy; sleeps: number[] } {
  const sleeps: number[] = [];
  const policy: RetryPolicy = {
    ...DEFAULT_RETRY_POLICY,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    ...overrides,
  };
  return { policy, sleeps };
}

test("default policy is 3 attempts, 250ms base, 4s cap, full jitter", () => {
  assert.strictEqual(DEFAULT_RETRY_POLICY.attempts, 3);
  assert.strictEqual(DEFAULT_RETRY_POLICY.baseDelayMs, 250);
  assert.strictEqual(DEFAULT_RETRY_POLICY.maxDelayMs, 4000);
  assert.strictEqual(DEFAULT_RETRY_POLICY.jitter, true);
  assert.strictEqual(typeof DEFAULT_RETRY_POLICY.isRetryable, "function");
  assert.strictEqual(typeof DEFAULT_RETRY_POLICY.sleep, "function");
});

test("default isRetryable accepts transient RPC failures and rejects others", () => {
  const isRetryable = DEFAULT_RETRY_POLICY.isRetryable.bind(DEFAULT_RETRY_POLICY);
  for (const transient of [
    "RPC Error 429 Too Many Requests",
    "RPC Error 500 Internal Server Error",
    "RPC Error 502 Bad Gateway",
    "RPC Error 503 Service Unavailable",
    "RPC Error 504 Gateway Timeout",
    "request timeout",
    "connection reset",
    "fetch failed",
  ]) {
    assert.strictEqual(isRetryable(new Error(transient)), true, transient);
  }
  for (const nonTransient of [
    "Contract Error Contract, #4: AlreadyClaimed",
    "400 Bad Request",
    "not funded",
  ]) {
    assert.strictEqual(isRetryable(new Error(nonTransient)), false, nonTransient);
  }
});

test("retries a retryable error and recovers", async () => {
  const { policy, sleeps } = fakeClockPolicy({ jitter: false });
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new Error("429 Too Many Requests");
    return "ok";
  }, policy);
  assert.strictEqual(result, "ok");
  assert.strictEqual(calls, 3);
  assert.deepStrictEqual(sleeps, [250, 500]);
});

test("gives up after `attempts` and surfaces the last error", async () => {
  const { policy, sleeps } = fakeClockPolicy({ attempts: 3, jitter: false });
  let calls = 0;
  await assert.rejects(
    async () =>
      await withRetry(async () => {
        calls++;
        throw new Error("503 Service Unavailable");
      }, policy),
    /503/,
  );
  assert.strictEqual(calls, 3);
  assert.deepStrictEqual(sleeps, [250, 500]);
});

test("non-retryable error surfaces immediately without sleeping", async () => {
  const { policy, sleeps } = fakeClockPolicy();
  let calls = 0;
  await assert.rejects(
    async () =>
      await withRetry(async () => {
        calls++;
        throw new Error("Contract Error Contract, #4: AlreadyClaimed");
      }, policy),
    /AlreadyClaimed/,
  );
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(sleeps, []);
});

test("attempts=1 never retries even a retryable error", async () => {
  const { policy, sleeps } = fakeClockPolicy({ attempts: 1 });
  let calls = 0;
  await assert.rejects(
    async () =>
      await withRetry(async () => {
        calls++;
        throw new Error("429 Too Many Requests");
      }, policy),
    /429/,
  );
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(sleeps, []);
});

test("backoff is capped at maxDelayMs", async () => {
  const { policy, sleeps } = fakeClockPolicy({ attempts: 6, baseDelayMs: 100, maxDelayMs: 150, jitter: false });
  let calls = 0;
  await assert.rejects(
    async () =>
      await withRetry(async () => {
        calls++;
        throw new Error("503 Service Unavailable");
      }, policy),
    /503/,
  );
  assert.strictEqual(calls, 6);
  assert.deepStrictEqual(sleeps, [100, 150, 150, 150, 150]);
});

test("full jitter keeps every delay within [0, capped backoff]", async () => {
  const { policy, sleeps } = fakeClockPolicy({ attempts: 50, baseDelayMs: 128, maxDelayMs: 256 });
  let calls = 0;
  await assert.rejects(
    async () =>
      await withRetry(async () => {
        calls++;
        throw new Error("fetch failed");
      }, policy),
    /fetch failed/,
  );
  assert.strictEqual(calls, 50);
  assert.strictEqual(sleeps.length, 49);
  for (const delay of sleeps) {
    assert.ok(delay >= 0 && delay < 256, `delay ${delay} within [0, 256)`);
  }
});

test("a submission step outside withRetry is never retried", async () => {
  const { policy, sleeps } = fakeClockPolicy();
  let submitCalls = 0;
  const simulate = async () => "signed-tx";
  const submit = async (_tx: unknown) => {
    submitCalls++;
    throw new Error("504 Gateway Timeout during polling");
  };
  await assert.rejects(async () => {
    const tx = await withRetry(simulate, policy);
    await submit(tx);
  }, /504/);
  assert.strictEqual(submitCalls, 1);
  assert.deepStrictEqual(sleeps, []);
});