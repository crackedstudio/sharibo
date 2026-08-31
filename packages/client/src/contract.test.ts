import { test } from "vitest";
import assert from "node:assert";
import { fund } from "./contract.js";

test("transient simulate-phase failure recovers", async () => {
  let simulateCalls = 0;
  let signAndSendCalls = 0;
  const mockTx = {
    signAndSend: async () => {
      signAndSendCalls++;
      return {
        result: undefined,
        sendTransactionResponse: { hash: "0xabc" },
      };
    },
  };

  const mockClient = {
    fund: (args: any) => {
      simulateCalls++;
      if (simulateCalls < 3) {
        throw new Error("RPC Error 429 Too Many Requests");
      }
      return mockTx;
    },
  };

  const result = await fund(mockClient, { circleId: 0n, from: "G..." });
  assert.strictEqual(simulateCalls, 3);
  assert.strictEqual(signAndSendCalls, 1);
  assert.strictEqual(result.hash, "0xabc");
});

test("post-submit failure surfaces immediately without a second submission", async () => {
  let simulateCalls = 0;
  let signAndSendCalls = 0;
  const mockTx = {
    signAndSend: async () => {
      signAndSendCalls++;
      throw new Error("RPC Error 504 Gateway Timeout during polling");
    },
  };

  const mockClient = {
    fund: (args: any) => {
      simulateCalls++;
      return mockTx;
    },
  };

  await assert.rejects(
    async () => await fund(mockClient, { circleId: 0n, from: "G..." }),
    /504/
  );
  assert.strictEqual(simulateCalls, 1);
  assert.strictEqual(signAndSendCalls, 1);
});
