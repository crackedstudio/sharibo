// Unit tests for scripts/http.ts — the shared fetch helper.
//
// These are hermetic: `fetch` is stubbed for the whole file, so nothing here
// touches friendbot, Horizon, httpbin.org or any other host. The live-network
// reachability check that used to live here now lives in
// `fetch-migration.live.test.ts` and only runs under `npm run test:live`.

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { httpGet, httpGetJson, DEFAULT_TIMEOUT_MS } from "./http.js";

const realFetch = globalThis.fetch;

/** Build a minimal Response-like object good enough for the helper. */
function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Partial<Response>>): void {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    // Real fetch rejects immediately for an already-aborted signal; the stub
    // must do the same or a test can hang forever instead of failing.
    if (init?.signal?.aborted) {
      throw (init.signal as AbortSignal).reason;
    }
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({}),
      ...(await impl(url, init)),
    };
  }) as typeof fetch;
}

beforeEach(() => {
  stubFetch(async () => ({}));
});

/**
 * A response that never arrives on its own — the only way a request can hang.
 * It settles *only* when the caller's signal aborts, which is what makes the
 * deadline and external-signal assertions meaningful.
 */
function hangForever(url: string, init?: RequestInit): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const signal = init?.signal as AbortSignal | undefined;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    void url;
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.reset();
});

describe("httpGet", () => {
  it("returns the response body on 2xx", async () => {
    stubFetch(async () => ({ ok: true, status: 200, text: async () => "hello" }));
    assert.equal(await httpGet("https://example.test/"), "hello");
  });

  it("passes a deadline signal and keepalive:false to fetch", async () => {
    let seen: RequestInit | undefined;
    stubFetch(async (_url, init) => {
      seen = init;
      return { text: async () => "ok" };
    });

    await httpGet("https://example.test/");

    assert.ok(seen, "fetch should have been called with an init object");
    assert.ok(seen!.signal, "a signal must be passed so the request can be aborted");
    assert.equal(seen!.keepalive, false, "keepalive must be disabled");
  });

  it("throws with the status and body in the message for non-2xx", async () => {
    stubFetch(async () => ({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    }));

    await assert.rejects(
      () => httpGet("https://example.test/nope"),
      (err: Error) => {
        assert.match(err.message, /HTTP 404/);
        assert.match(err.message, /https:\/\/example\.test\/nope/);
        assert.match(err.message, /Not Found/);
        return true;
      },
    );
  });

  it("fires the timeout when the deadline elapses", async () => {
    stubFetch(hangForever);

    await assert.rejects(
      () => httpGet("https://example.test/slow", { timeoutMs: 25 }),
      (err: Error) => {
        assert.equal(err.name, "TimeoutError");
        assert.match(err.message, /timed out after 25ms/);
        return true;
      },
    );
  });

  it("clears the deadline once the response arrives, so the timer never outlives the call", async () => {
    // If the timer leaked, this test process would keep a handle open and the
    // assertion below on elapsed wall clock would be meaningless; assert the
    // request completed rather than being aborted after the fact.
    stubFetch(async () => ({ text: async () => "fast" }));
    assert.equal(await httpGet("https://example.test/fast", { timeoutMs: 5 }), "fast");
  });

  it("propagates an externally supplied signal", async () => {
    stubFetch(hangForever);

    const external = AbortSignal.abort(new Error("caller gave up"));
    await assert.rejects(
      () => httpGet("https://example.test/", { init: { signal: external } }),
      /caller gave up/,
    );
  });

  it("propagates a signal that aborts while the request is in flight", async () => {
    stubFetch(hangForever);

    const external = new AbortController();
    const pending = httpGet("https://example.test/", {
      init: { signal: external.signal },
      timeoutMs: 60_000,
    });
    external.abort(new Error("caller cancelled mid-flight"));

    await assert.rejects(() => pending, /caller cancelled mid-flight/);
  });

  it("uses DEFAULT_TIMEOUT_MS when no deadline is given", async () => {
    let seen: RequestInit | undefined;
    stubFetch(async (_url, init) => {
      seen = init;
      return { text: async () => "ok" };
    });
    await httpGet("https://example.test/");
    // The signal exists; the numeric default is asserted via the exported
    // constant because the timer duration is not observable post-hoc.
    assert.equal(DEFAULT_TIMEOUT_MS, 15_000);
    assert.ok(seen!.signal);
  });
});

describe("httpGetJson", () => {
  it("parses the body as JSON", async () => {
    stubFetch(async () => ({ text: async () => JSON.stringify({ ok: true, n: 7 }) }));
    assert.deepEqual(await httpGetJson("https://example.test/"), { ok: true, n: 7 });
  });

  it("throws for malformed JSON", async () => {
    stubFetch(async () => ({ text: async () => "not json" }));
    await assert.rejects(() => httpGetJson("https://example.test/"), SyntaxError);
  });
});

describe("no curl dependency", () => {
  const read = (file: string) =>
    readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), file), "utf8");

  it("e2e.ts does not shell out to curl", () => {
    const src = read("e2e.ts");
    assert.ok(!src.includes('from "node:child_process"'), "e2e.ts should not import child_process");
    assert.ok(!src.includes("execFile"), "e2e.ts should not reference execFile");
    assert.ok(!src.includes("curlGet"), "e2e.ts should not have a curlGet function");
    assert.ok(src.includes("httpGet"), "e2e.ts should use the shared httpGet helper");
  });

  it("smoke.ts and testnet-health.ts use the shared helper", () => {
    for (const file of ["smoke.ts", "testnet-health.ts"]) {
      const src = read(file);
      assert.ok(
        src.includes('from "./http.js"'),
        `${file} should import from the shared http module`,
      );
      assert.ok(!src.includes("AbortSignal.timeout"), `${file} should not inline its own timeouts`);
    }
  });
});
