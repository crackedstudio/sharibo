import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCapabilityReport } from "./capabilities.js";

beforeEach(() => {
  vi.stubGlobal("WebAssembly", {});
  vi.stubGlobal("BigInt", BigInt);
  vi.stubGlobal("crypto", { subtle: {} });
  vi.stubGlobal("window", { isSecureContext: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getCapabilityReport", () => {
  it("reports missing WebAssembly", () => {
    vi.stubGlobal("WebAssembly", undefined);

    expect(getCapabilityReport().missing).toEqual(["webassembly"]);
  });

  it("reports missing BigInt", () => {
    vi.stubGlobal("BigInt", undefined);

    expect(getCapabilityReport().missing).toEqual(["bigint"]);
  });

  it("reports missing crypto.subtle", () => {
    vi.stubGlobal("crypto", {});

    expect(getCapabilityReport().missing).toEqual(["crypto.subtle"]);
  });

  it("reports missing secure context instead of dependent crypto.subtle", () => {
    vi.stubGlobal("crypto", undefined);
    vi.stubGlobal("window", { isSecureContext: false });

    const report = getCapabilityReport();

    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(["secure-context"]);
    expect(report.details).toEqual([expect.stringContaining("HTTPS or localhost")]);
  });

  it("passes when every required browser capability is present", () => {
    expect(getCapabilityReport()).toEqual({ ok: true, missing: [], details: [] });
  });
});
