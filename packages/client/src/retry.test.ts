import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  withRetry,
  computeDelay,
  DEFAULT_RETRY_POLICY,
  POLL_RETRY_POLICY,
  PATIENT_RETRY_POLICY,
} from "./retry.js";
import { SdkEventEmitter } from "./events.js";

describe("computeDelay", () => {
  it("doubles per attempt and applies jitter in [0.5, 1.0]", () => {
    const policy = { maxRetries: 3, baseDelayMs: 100 };
    expect(computeDelay(policy, 1, () => 0)).toBe(50); // 100 * 1 * 0.5
    expect(computeDelay(policy, 1, () => 1)).toBe(100); // 100 * 1 * 1.0
    expect(computeDelay(policy, 2, () => 0)).toBe(100); // 100 * 2 * 0.5
    expect(computeDelay(policy, 3, () => 1)).toBe(400); // 100 * 4 * 1.0
  });
});

describe("retry presets", () => {
  it("exports named presets with documented budgets", () => {
    expect(POLL_RETRY_POLICY.maxRetries).toBe(1);
    expect(DEFAULT_RETRY_POLICY.maxRetries).toBe(3);
    expect(DEFAULT_RETRY_POLICY.baseDelayMs).toBe(500);
    expect(PATIENT_RETRY_POLICY.maxRetries).toBe(5);
    // Worst-case sleep for DEFAULT: 500 * (2^3 - 1) = 3500
    const defaultWorst =
      DEFAULT_RETRY_POLICY.baseDelayMs * (2 ** DEFAULT_RETRY_POLICY.maxRetries - 1);
    expect(defaultWorst).toBe(3500);
  });
});

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const promise = withRetry(fn, POLL_RETRY_POLICY);
    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient 429 failures then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 10 });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient ContractError-like messages", async () => {
    const err = new Error("ContractError: AlreadyClaimed");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, DEFAULT_RETRY_POLICY)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("exhausts the retry budget and rethrows", async () => {
    const err = new Error("503 Service Unavailable");
    const fn = vi.fn().mockRejectedValue(err);
    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 5 });
    const assertion = expect(promise).rejects.toBe(err);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("emits rpc:attempt, rpc:retry, and rpc:success", async () => {
    const events: string[] = [];
    const emitter = new SdkEventEmitter((e) => events.push(e.type));

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn, { maxRetries: 1, baseDelayMs: 10 }, emitter);
    await vi.runAllTimersAsync();
    await promise;

    expect(events).toEqual(["rpc:attempt", "rpc:retry", "rpc:attempt", "rpc:success"]);
  });
});
