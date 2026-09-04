import { test, afterAll as after } from "vitest";
import assert from "node:assert";
import {
  prefetchMembershipArtifacts,
  subscribeToArtifactPrefetch,
  getArtifactPrefetchProgress,
  __resetForTesting,
} from "./artifacts.js";

// Utility to create a controllable ReadableStream
function createControllableStream() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return { stream, controller: controller! };
}

// Mock fetch globally
const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
});

test("fraction is null when content-length is missing", async () => {
  __resetForTesting();

  const { stream: wasmStream, controller: wasmController } = createControllableStream();
  const { stream: zkeyStream, controller: zkeyController } = createControllableStream();

  globalThis.fetch = async (url: string | URL | globalThis.Request) => {
    const urlStr = url.toString();
    if (urlStr.includes("wasm")) {
      return new Response(wasmStream, { headers: new Headers() });
    }
    return new Response(zkeyStream, { headers: new Headers() });
  };

  const promise = prefetchMembershipArtifacts();

  // Give promise a tick to start fetching
  await new Promise((resolve) => setTimeout(resolve, 0));

  let progress = getArtifactPrefetchProgress();
  assert.strictEqual(progress.status, "loading");
  assert.strictEqual(progress.fraction, null);

  wasmController.enqueue(new Uint8Array([1, 2, 3]));
  await new Promise((resolve) => setTimeout(resolve, 0));

  progress = getArtifactPrefetchProgress();
  assert.strictEqual(progress.fraction, null);
  assert.strictEqual(progress.loaded, 3);

  wasmController.close();
  zkeyController.close();
  await promise;

  progress = getArtifactPrefetchProgress();
  assert.strictEqual(progress.status, "ready");
  assert.strictEqual(progress.fraction, 1);
});

test("fraction is monotonically increasing when content-length is present", async () => {
  __resetForTesting();

  const { stream: wasmStream, controller: wasmController } = createControllableStream();
  const { stream: zkeyStream, controller: zkeyController } = createControllableStream();

  globalThis.fetch = async (url: string | URL | globalThis.Request) => {
    const urlStr = url.toString();
    if (urlStr.includes("wasm")) {
      return new Response(wasmStream, { headers: new Headers({ "content-length": "10" }) });
    }
    return new Response(zkeyStream, { headers: new Headers({ "content-length": "20" }) });
  };

  const promise = prefetchMembershipArtifacts();
  await new Promise((resolve) => setTimeout(resolve, 0));

  wasmController.enqueue(new Uint8Array(5));
  await new Promise((resolve) => setTimeout(resolve, 0));

  let progress = getArtifactPrefetchProgress();
  assert.strictEqual(progress.loaded, 5);
  assert.strictEqual(progress.total, 30);
  assert.strictEqual(progress.fraction, 5 / 30);

  zkeyController.enqueue(new Uint8Array(10));
  await new Promise((resolve) => setTimeout(resolve, 0));

  progress = getArtifactPrefetchProgress();
  assert.strictEqual(progress.loaded, 15);
  assert.strictEqual(progress.fraction, 15 / 30);

  wasmController.close();
  zkeyController.close();
  await promise;

  progress = getArtifactPrefetchProgress();
  assert.strictEqual(progress.status, "ready");
  assert.strictEqual(progress.fraction, 1);
});

test("concurrent prefetchMembershipArtifacts calls share one download", async () => {
  __resetForTesting();
  let fetchCount = 0;

  const { stream: wasmStream, controller: wasmController } = createControllableStream();
  const { stream: zkeyStream, controller: zkeyController } = createControllableStream();

  globalThis.fetch = async (url: string | URL | globalThis.Request) => {
    fetchCount++;
    const urlStr = url.toString();
    if (urlStr.includes("wasm")) {
      return new Response(wasmStream, { headers: new Headers() });
    }
    return new Response(zkeyStream, { headers: new Headers() });
  };

  const p1 = prefetchMembershipArtifacts();
  const p2 = prefetchMembershipArtifacts();

  assert.strictEqual(p1, p2);

  wasmController.close();
  zkeyController.close();
  await p1;

  // We should have only called fetch twice (once for wasm, once for zkey)
  assert.strictEqual(fetchCount, 2);
});

test("failed download publishes status: 'error' and rejects", async () => {
  __resetForTesting();

  globalThis.fetch = async () => {
    throw new Error("Network offline");
  };

  await assert.rejects(prefetchMembershipArtifacts(), /Network offline/);

  const progress = getArtifactPrefetchProgress();
  assert.strictEqual(progress.status, "error");
  assert.strictEqual(progress.error?.message, "Network offline");
});

test("failed response publishes status: 'error' and rejects", async () => {
  __resetForTesting();

  globalThis.fetch = async () => {
    return new Response(null, { status: 404 });
  };

  await assert.rejects(prefetchMembershipArtifacts(), /Unable to download circuit artifact/);

  const progress = getArtifactPrefetchProgress();
  assert.strictEqual(progress.status, "error");
  assert.ok(progress.error?.message.includes("Unable to download"));
});

test("subscribeToArtifactPrefetch immediately calls back with current progress and unsubscribing stops delivery", async () => {
  __resetForTesting();

  const { stream: wasmStream, controller: wasmController } = createControllableStream();
  const { stream: zkeyStream, controller: zkeyController } = createControllableStream();

  globalThis.fetch = async (url: string | URL | globalThis.Request) => {
    const urlStr = url.toString();
    if (urlStr.includes("wasm")) {
      return new Response(wasmStream, { headers: new Headers() });
    }
    return new Response(zkeyStream, { headers: new Headers() });
  };

  const states: string[] = [];
  const unsubscribe = subscribeToArtifactPrefetch((p) => {
    states.push(p.status);
  });

  // Should immediately receive the current 'idle' state
  assert.deepStrictEqual(states, ["idle"]);

  const p = prefetchMembershipArtifacts();
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Should now have 'loading' states
  assert.ok(states.includes("loading"));

  const statesLengthBeforeUnsubscribe = states.length;
  unsubscribe();

  wasmController.enqueue(new Uint8Array(10));
  await new Promise((resolve) => setTimeout(resolve, 0));

  // states should not have increased because we unsubscribed
  assert.strictEqual(states.length, statesLengthBeforeUnsubscribe);

  wasmController.close();
  zkeyController.close();
  await p;
});
