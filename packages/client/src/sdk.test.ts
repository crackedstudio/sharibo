import { describe, it, expect, vi } from "vitest";
import { ShariboSDK } from "./sdk";
import { getStatus } from "./contract";
import type { CircleStatus } from "./contract";

// Minimal fake client: the facade only forwards to the free functions in
// contract.ts, so we stub the underlying contract call surface here.
function makeClient() {
  return {
    getStatus: vi.fn(),
    getCircleCount: vi.fn(),
  } as unknown as Parameters<typeof getStatus>[0];
}

describe("ShariboSDK.getStatus", () => {
  it("delegates to the free getStatus and returns the typed CircleStatus", async () => {
    const client = makeClient();
    const expected: CircleStatus = {
      round: 3,
      pot: 1000n,
      potTarget: 5000n,
      cancelled: false,
    };

    // The free function is what the facade must agree with.
    vi.mocked(getStatus).mockResolvedValue(expected);

    const sdk = new ShariboSDK(client);
    const result = await sdk.getStatus(42n);

    expect(result).toEqual(expected);
    expect(getStatus).toHaveBeenCalledWith(client, 42n);
  });

  it("agrees with the free getStatus for the same circle id", async () => {
    const client = makeClient();
    const expected: CircleStatus = {
      round: 7,
      pot: 250n,
      potTarget: 1000n,
      cancelled: true,
    };

    vi.mocked(getStatus).mockResolvedValue(expected);

    const sdk = new ShariboSDK(client);
    const [fromFacade, fromFree] = await Promise.all([sdk.getStatus(7n), getStatus(client, 7n)]);

    expect(fromFacade).toEqual(fromFree);
  });
});
