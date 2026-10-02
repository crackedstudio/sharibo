// LIVE network test — NOT part of the default unit suite.
//
//   npm test          # hermetic: no host is contacted
//   npm run test:live # this file, against real friendbot / Horizon
//
// The `.live.ts` suffix (not `.live.test.ts`) is deliberate: Node's `--test`
// glob has no exclusion syntax, so a `*.test.ts` glob would match a
// `*.live.test.ts` file and quietly run it in the default suite. A `.live.ts`
// file can never be picked up by `*.test.ts`. See hermeticity.test.ts.
//
// Why it exists: it is the reachability check that used to live in the
// hermetic suite. It is the regression guard for the original problem it
// documents — Node's fetch/undici appearing to hang against friendbot and
// Horizon, which is what pushed e2e.ts into shelling out to `curl`. If the
// hang ever comes back, this is the test that catches it, and it belongs
// behind an explicit command rather than in the default gate.
//
// It spends friendbot quota, so run it deliberately, not on every commit.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { httpGet } from "./http.js";

const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";

describe("live: fetch reaches the Stellar testnet endpoints", () => {
  it("Horizon root responds with a version and links", async () => {
    const body = await httpGet(`${HORIZON}/`);
    const data = JSON.parse(body);
    assert.ok(data.horizon_version, "should have horizon_version");
    assert.ok(data._links, "should have _links");
  });

  it("friendbot answers (an existing account returns 4xx, not a hang)", async () => {
    // A well-known test key that has already been funded. friendbot returns
    // 400 for an existing account; what matters here is that the request
    // completes at all rather than hanging.
    const pk = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEBD9AFZQ7TM4JRS9A";
    try {
      await httpGet(`${FRIENDBOT}?addr=${pk}`);
    } catch (err) {
      assert.match(
        (err as Error).message,
        /HTTP (400|4\d\d)/,
        "expected an HTTP 4xx, not a hang or timeout",
      );
    }
  });

  it("returns 404 for an unknown Horizon path", async () => {
    await assert.rejects(
      () => httpGet(`${HORIZON}/nonexistent-endpoint-404`),
      (err: Error) => /HTTP 404/.test(err.message),
      "should throw with HTTP 404",
    );
  });
});
