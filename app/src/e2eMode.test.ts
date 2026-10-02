/**
 * Guards the acceptance criteria of the browser e2e suite from inside the
 * fast unit run: the default path is the mock path, live mode needs the exact
 * opt-in, and `npm test` never collects the Playwright specs.
 */
import { describe, it, expect } from "vitest";
import pkg from "../package.json";
import vitestConfig from "../vitest.config";
import {
  MOCK_APP_ENV,
  TESTNET_PASSPHRASE,
  liveConfigProblems,
  resolveMode,
} from "../e2e/mode";

const VALID_ID = `C${"B".repeat(55)}`;

describe("resolveMode", () => {
  it("defaults to mock", () => {
    expect(resolveMode({})).toBe("mock");
  });

  it("selects live only for the exact string 1", () => {
    expect(resolveMode({ E2E_LIVE: "1" })).toBe("live");
  });

  it.each(["", "0", "true", "yes", "on", " 1", "1 "])("treats E2E_LIVE=%j as mock", (value) => {
    expect(resolveMode({ E2E_LIVE: value })).toBe("mock");
  });
});

describe("mock app env", () => {
  it("points RPC at a host that can never resolve", () => {
    expect(new URL(MOCK_APP_ENV.VITE_STELLAR_RPC_URL).hostname.endsWith(".invalid")).toBe(true);
  });

  it("is refused by the live-mode preflight", () => {
    expect(liveConfigProblems(MOCK_APP_ENV).length).toBeGreaterThan(0);
  });
});

describe("liveConfigProblems", () => {
  const good = {
    VITE_SHARIBO_CONTRACT_ID: VALID_ID,
    VITE_TEST_TOKEN_CONTRACT_ID: VALID_ID,
    VITE_STELLAR_NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
  };

  it("accepts a real-looking testnet config", () => {
    expect(liveConfigProblems(good)).toEqual([]);
  });

  it("treats an unset passphrase as testnet, matching the app's own default", () => {
    expect(
      liveConfigProblems({ ...good, VITE_STELLAR_NETWORK_PASSPHRASE: undefined }),
    ).toEqual([]);
  });

  it("reports missing contract IDs", () => {
    expect(liveConfigProblems({})).toHaveLength(2);
  });

  it("reports malformed contract IDs", () => {
    expect(liveConfigProblems({ ...good, VITE_SHARIBO_CONTRACT_ID: "nope" })).toHaveLength(1);
  });

  it("refuses any network other than testnet", () => {
    const problems = liveConfigProblems({
      ...good,
      VITE_STELLAR_NETWORK_PASSPHRASE: "Public Global Stellar Network ; September 2015",
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/testnet only/i);
  });
});

describe("isolation from `npm test`", () => {
  it("keeps the unit test script free of Playwright", () => {
    expect(pkg.scripts.test).toBe("vitest run");
  });

  it("never sets the live opt-in in an npm script", () => {
    for (const command of Object.values(pkg.scripts)) {
      expect(command).not.toContain("E2E_LIVE");
    }
  });

  it("exposes the browser suite as its own script", () => {
    expect(pkg.scripts["test:e2e"]).toContain("playwright test");
  });

  it("excludes e2e/ from vitest collection", () => {
    expect(vitestConfig.test?.exclude).toContain("e2e/**");
  });
});
