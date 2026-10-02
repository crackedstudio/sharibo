import { beforeEach, describe, expect, it, vi } from "vitest";

const { getHealth, getLedgerEntries } = vi.hoisted(() => ({
  getHealth: vi.fn(),
  getLedgerEntries: vi.fn(),
}));

vi.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: vi.fn(() => ({ getHealth, getLedgerEntries })),
  },
  Address: vi.fn(),
  xdr: {},
}));

import { checkContractDeployed } from "./testnetHealth.js";

describe("checkContractDeployed reachability", () => {
  beforeEach(() => {
    getHealth.mockReset();
    getLedgerEntries.mockReset();
  });

  it("distinguishes an unreachable RPC from a healthy RPC with a missing contract", async () => {
    getHealth.mockRejectedValue(new TypeError("Failed to fetch"));

    const result = await checkContractDeployed("https://rpc.example.test", "CEXAMPLE");

    expect(result).toEqual({ ok: true, rpcReachable: false });
    expect(getLedgerEntries).not.toHaveBeenCalled();
  });
});
