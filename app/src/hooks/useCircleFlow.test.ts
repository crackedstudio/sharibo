import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCircleFlow } from "./useCircleFlow";

// Point at the manual mock explicitly
vi.mock("@sharibo/client", () => import("../../../__mocks__/@sharibo/client"));

vi.mock("../config", () => ({
  config: {
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    testTokenContractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  },
  configError: [],
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    Keypair: {
      random: vi.fn(() => ({
        publicKey: () => "GMOCKPUBLICKEY000000000000000000000000000000000000000000",
        secret: () => "SMOCKSECRETKEY000000000000000000000000000000000000000000",
      })),
      fromSecret: vi.fn((sec: string) => ({
        publicKey: () => "GMOCKPUBLICKEY000000000000000000000000000000000000000000",
        secret: () => sec,
      })),
    },
  };
});

vi.mock("@stellar/freighter-api", () => ({
  isConnected: vi.fn().mockResolvedValue({ isConnected: true }),
  isAllowed: vi.fn().mockResolvedValue({ isAllowed: true }),
  requestAccess: vi
    .fn()
    .mockResolvedValue({ address: "GFREIGHTER0000000000000000000000000000000000000000000" }),
  getAddress: vi
    .fn()
    .mockResolvedValue({ address: "GFREIGHTER0000000000000000000000000000000000000000000" }),
  getNetworkDetails: vi.fn().mockResolvedValue({
    network: "TESTNET",
    networkPassphrase: "Test SDF Network ; September 2015",
  }),
  signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: "AAAA" }),
}));

global.fetch = vi.fn().mockImplementation((url: string) => {
  if (typeof url === "string" && url.includes("verification_key.json")) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        alpha: "0x01",
        beta: "0x02",
        gamma: "0x03",
        delta: "0x04",
        ic: ["0x05"],
      }),
    });
  }
  if (typeof url === "string" && (url.includes(".wasm") || url.includes(".zkey"))) {
    return Promise.resolve({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
  }
  return Promise.resolve({
    ok: true,
    json: async () => ({}),
  });
});

window.confirm = vi.fn().mockReturnValue(true);

describe("useCircleFlow hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  function setupHook() {
    return renderHook(() => useCircleFlow());
  }

  it("initializes with default landing state", async () => {
    const { result } = await setupHook();

    expect(result.current.screen).toBe("landing");
    expect(result.current.circlePhase).toBe("idle");
    expect(result.current.busy).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.contributionXlm).toBe(10);
    expect(result.current.admin).toBeNull();
    expect(result.current.members).toEqual([]);
    expect(result.current.circleId).toBeNull();
    expect(result.current.round).toBe(0);
    expect(result.current.pot).toBe(0n);
    expect(result.current.claimantIndex).toBe(0);
    expect(result.current.proof).toBeNull();
    expect(result.current.nullifierHash).toBeNull();
    expect(result.current.claimResult).toBeNull();
    expect(result.current.isProving).toBe(false);
    expect(result.current.nullifierClaimed).toBe(false);
    expect(result.current.rejection).toBeNull();
    expect(result.current.fundedCount).toBe(0);
    expect(result.current.fullyFunded).toBe(false);
    expect(result.current.step).toBe(1);
    await waitFor(() => {
      expect(result.current.hasFreighter).toBe(true);
    });
  });

  it("starts a circle successfully", async () => {
    const { result } = await setupHook();

    await act(async () => {
      await result.current.startCircle();
    });

    expect(result.current.screen).toBe("circle");
    expect(result.current.circlePhase).toBe("ready");
    expect(result.current.circleId).toBe(37n);
    expect(result.current.members).toHaveLength(5);
    expect(result.current.admin).not.toBeNull();
    expect(result.current.round).toBe(0);
    expect(result.current.pot).toBe(0n);
    expect(result.current.busy).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("funds a member via friendbot and updates member status", async () => {
    const { result } = await setupHook();

    await act(async () => {
      await result.current.startCircle();
    });

    await act(async () => {
      await result.current.fundMember(0);
    });

    expect(result.current.members[0].funded).toBe(true);
    expect(result.current.members[0].fundHash).toBe("mockFundHash");
    expect(result.current.fundedCount).toBe(1);
  });

  it("funds a member via Freighter wallet", async () => {
    const { result } = await setupHook();

    await act(async () => {
      await result.current.startCircle();
    });

    await act(async () => {
      await result.current.fundWithFreighter(1);
    });

    expect(result.current.members[1].funded).toBe(true);
    expect(result.current.members[1].freighterKey).toBe(
      "GFREIGHTER0000000000000000000000000000000000000000000",
    );
    expect(result.current.members[1].fundHash).toBe("mockFundHash");
  });

  it("updates claimantIndex with setClaimantIndex", async () => {
    const { result } = await setupHook();

    act(() => {
      result.current.setClaimantIndex(3);
    });

    expect(result.current.claimantIndex).toBe(3);
  });

  it("executes doClaim successfully and generates proof", async () => {
    const { result } = await setupHook();

    await act(async () => {
      await result.current.startCircle();
    });

    await act(async () => {
      await result.current.doClaim();
    });

    expect(result.current.proof).not.toBeNull();
    expect(result.current.nullifierHash).toBe(77n);
    expect(result.current.claimResult).not.toBeNull();
    expect(result.current.claimResult?.hash).toBe("mockClaimHash");
    expect(result.current.step).toBe(3);
  });

  it("replays a claim with claimAgain", async () => {
    const { result } = await setupHook();

    await act(async () => {
      await result.current.startCircle();
      await result.current.doClaim();
    });

    await act(async () => {
      await result.current.claimAgain();
    });

    expect(result.current.rejection).toBeDefined();
  });

  it("cancels a circle with doCancelCircle", async () => {
    const { result } = await setupHook();

    await act(async () => {
      await result.current.startCircle();
    });

    await act(async () => {
      await result.current.doCancelCircle();
    });

    expect(result.current.busy).toBeNull();
  });

  it("resets back to landing screen and updates previousCircleId", async () => {
    const { result } = await setupHook();

    await act(async () => {
      await result.current.startCircle();
    });
    expect(result.current.circleId).toBe(37n);

    act(() => {
      result.current.resetToLanding();
    });

    expect(result.current.screen).toBe("landing");
    expect(result.current.circleId).toBeNull();
    expect(result.current.previousCircleId).toBe(37n);
    expect(result.current.members).toHaveLength(0);
  });

  it("loads state from session storage payload", async () => {
    const { result } = await setupHook();

    const savedState = {
      contributionXlm: 25,
      adminSecret: "SMOCKSECRETKEY000000000000000000000000000000000000000000",
      members: [
        {
          secret: "SMOCKSECRETKEY000000000000000000000000000000000000000000",
          identity: { identityNullifier: 1n, identitySecret: 2n, commitment: 3n },
          fundHash: "prevHash",
        },
      ],
      circleId: 42n,
      round: 1,
      claimantIndex: 0,
      proof: null,
      nullifierHash: null,
      claimResult: null,
      rejection: null,
    };

    await act(async () => {
      result.current.loadState(savedState);
      await new Promise((r) => setTimeout(r, 120));
    });

    expect(result.current.screen).toBe("circle");
    expect(result.current.contributionXlm).toBe(25);
    expect(result.current.circleId).toBe(42n);
    expect(result.current.round).toBe(1);
    expect(result.current.members).toHaveLength(1);
  });

  it("dismissResumePrompt clears resumePrompt state", async () => {
    const { result } = await setupHook();

    act(() => {
      result.current.dismissResumePrompt();
    });

    expect(result.current.resumePrompt).toBeNull();
  });
});
