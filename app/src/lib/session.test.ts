import { clearSession, loadSession, saveSession, SESSION_STORAGE_KEY } from "./session.js";

describe("session persistence", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips bigint values", () => {
    expect(saveSession({ circleId: 42n })).toBe(true);
    expect(loadSession()).toEqual({ ok: true, value: { circleId: 42n, version: 1 } });
  });

  it("keeps marker-prefixed user strings", () => {
    saveSession({ value: "BIGINT::not-a-number" });
    expect(loadSession()).toEqual({ ok: true, value: { value: "BIGINT::not-a-number", version: 1 } });
  });

  it("rejects corrupt JSON", () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, "{");
    expect(loadSession()).toEqual({ ok: false, reason: "corrupt" });
  });

  it("discards an old version", () => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ version: 0 }));
    expect(loadSession()).toEqual({ ok: false, reason: "version-mismatch" });
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it("handles storage errors without throwing", () => {
    const original = sessionStorage.removeItem;
    sessionStorage.removeItem = () => { throw new Error("blocked"); };
    expect(clearSession()).toBe(false);
    sessionStorage.removeItem = original;
  });
});
