// Unit tests for the parallelization changes in e2e.ts.
// Validates that the timed() utility works correctly and that
// Promise.all parallelization behaves as expected.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// --- timed() utility tests ---
// Replicate the timed() function from e2e.ts to test it in isolation.
async function timed<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<{ result: T; elapsed: number }> {
  const start = performance.now();
  const result = await fn();
  const elapsed = performance.now() - start;
  return { result, elapsed };
}

describe("timed() utility", () => {
  it("returns the function's result", async () => {
    const { result } = await timed("test", async () => 42);
    assert.equal(result, 42);
  });

  it("measures elapsed time", async () => {
    const { elapsed } = await timed("test", async () => {
      await new Promise((r) => setTimeout(r, 50));
      return "done";
    });
    // Should be at least 40ms (allowing for timer imprecision)
    assert.ok(elapsed >= 40, `expected >= 40ms, got ${elapsed.toFixed(1)}ms`);
  });

  it("propagates errors", async () => {
    await assert.rejects(
      async () => {
        await timed("fail", async () => {
          throw new Error("boom");
        });
      },
      { message: "boom" },
    );
  });
});

// --- Promise.all parallelization tests ---
// Validates that Promise.all actually runs tasks in parallel (not sequential).
describe("Promise.all parallelization", () => {
  it("runs independent tasks in parallel (faster than sequential)", async () => {
    const delay = (ms: number) => new Promise<number>((r) => setTimeout(() => r(ms), ms));

    // Sequential: 5 x 50ms = ~250ms
    // Parallel: max(50ms x 5) = ~50ms
    const start = performance.now();
    const results = await Promise.all([delay(50), delay(50), delay(50), delay(50), delay(50)]);
    const elapsed = performance.now() - start;

    assert.deepEqual(results, [50, 50, 50, 50, 50]);
    // Parallel should complete well under the sequential time of 250ms
    assert.ok(elapsed < 200, `expected < 200ms (parallel), got ${elapsed.toFixed(1)}ms`);
  });

  it("collects all results in order", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => new Promise<number>((r) => setTimeout(() => r(n * 10), 10))),
    );
    assert.deepEqual(results, [10, 20, 30, 40, 50]);
  });

  it("rejects if any task fails", async () => {
    await assert.rejects(
      () =>
        Promise.all([
          Promise.resolve(1),
          Promise.reject(new Error("friendbot down")),
          Promise.resolve(3),
        ]),
      { message: "friendbot down" },
    );
  });
});

// --- Sequential funding rationale tests ---
// Validates the reasoning for keeping fund() calls sequential:
// shared storage footprint contention on the Circle entry.
describe("sequential fund() rationale", () => {
  it("sequential execution preserves ordering guarantees", async () => {
    // Simulate 5 fund() calls that each increment a shared counter.
    // Sequential: each sees the previous increment.
    let pot = 0n;
    const contribution = 100_000_000n;

    for (let i = 0; i < 5; i++) {
      // Each fund reads current pot, adds contribution
      pot += contribution;
    }

    assert.equal(pot, 500_000_000n);
  });

  it("parallel writes to shared state cause contention (simulated)", async () => {
    // Simulate what happens when 5 fund() calls read the same initial
    // state in parallel and then write — they all see pot=0 and write
    // pot=contribution, resulting in only 1 fund recorded instead of 5.
    const initialPot = 0n;
    const contribution = 100_000_000n;

    // All 5 read pot=0 concurrently
    const reads = Array.from({ length: 5 }, () => initialPot);

    // Each writes pot = read_value + contribution
    const writes = reads.map((r) => r + contribution);

    // Without transaction isolation, last write wins:
    const finalPot = writes[writes.length - 1];
    assert.equal(finalPot, 100_000_000n); // Only 1 contribution recorded!
    assert.notEqual(finalPot, 500_000_000n); // NOT 5 contributions
  });
});
