import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("../config.js", () => ({
  config: {
    rpcUrl: "https://rpc.example.test",
    contractId: "CEXAMPLE",
  },
}));

vi.mock("../lib/testnetHealth.js", () => ({
  checkContractDeployed: vi.fn(),
}));

import { checkContractDeployed } from "../lib/testnetHealth.js";
import { useOnlineStatus } from "./useOnlineStatus.js";

const checkRpc = vi.mocked(checkContractDeployed);
const originalOnlineDescriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");

function setNavigatorOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: online,
  });
}

beforeEach(() => {
  setNavigatorOnline(true);
  checkRpc.mockReset().mockResolvedValue({ ok: true, rpcReachable: true });
});

afterEach(() => {
  if (originalOnlineDescriptor) {
    Object.defineProperty(navigator, "onLine", originalOnlineDescriptor);
  }
  vi.restoreAllMocks();
});

describe("useOnlineStatus", () => {
  it("initializes from navigator.onLine", () => {
    setNavigatorOnline(false);

    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current).toBe(false);
    expect(checkRpc).not.toHaveBeenCalled();
  });

  it("updates on online and offline events", async () => {
    const { result } = renderHook(() => useOnlineStatus());
    await waitFor(() => expect(result.current).toBe(true));

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);

    await act(async () => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("reports offline when the link is up but the configured RPC is unreachable", async () => {
    checkRpc.mockResolvedValue({ ok: true, rpcReachable: false });

    const { result } = renderHook(() => useOnlineStatus());

    expect(navigator.onLine).toBe(true);
    await waitFor(() => expect(result.current).toBe(false));
    expect(checkRpc).toHaveBeenCalledWith("https://rpc.example.test", "CEXAMPLE");
  });

  it("removes both event listeners on unmount", () => {
    const removeListener = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useOnlineStatus());

    unmount();

    expect(removeListener).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith("offline", expect.any(Function));
  });
});
