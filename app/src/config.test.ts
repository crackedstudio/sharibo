/**
 * Tests for app/src/config.ts — the gate between the app and a misconfigured
 * deployment.
 *
 * `config.ts` reads `import.meta.env.*` at module load, so each case reloads a
 * fresh module with the target env stubbed via `vi.stubEnv` (then
 * `vi.unstubAllEnvs()` after every test). This exercises exactly the same
 * module-level `config`/`configError`/`validate()` exports the app consumes.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

interface EnvMap {
  VITE_SHARIBO_CONTRACT_ID: string;
  VITE_STELLAR_RPC_URL: string;
  VITE_STELLAR_NETWORK_PASSPHRASE: string;
  VITE_TEST_TOKEN_CONTRACT_ID: string;
}

// A valid 56-char Stellar contract ID = "C" followed by 55 chars from [A-Z2-7].
const REAL_CONTRACT_ID = `C${"A".repeat(55)}`;
const REAL_TOKEN_ID = `C${"B".repeat(55)}`;

// The populated config object a valid build should produce (camelCase keys).
const EXPECTED_CONFIG = {
  contractId: REAL_CONTRACT_ID,
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  testTokenContractId: REAL_TOKEN_ID,
};

const VALID: EnvMap = {
  VITE_SHARIBO_CONTRACT_ID: REAL_CONTRACT_ID,
  VITE_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  VITE_STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  VITE_TEST_TOKEN_CONTRACT_ID: REAL_TOKEN_ID,
};

const CONTRACT = "VITE_SHARIBO_CONTRACT_ID";
const RPC = "VITE_STELLAR_RPC_URL";
const PASSPHRASE = "VITE_STELLAR_NETWORK_PASSPHRASE";
const TOKEN = "VITE_TEST_TOKEN_CONTRACT_ID";

const CONTRACT_SHAPE_SUFFIX =
  "expected a 56-character Stellar contract ID starting with 'C'";

/**
 * Reloads config.ts (fresh module) with `withEnv` stubbed into
 * `import.meta.env`. Keys whose value is `undefined` are intentionally left
 * unstubbed, so they read as genuinely missing.
 */
async function loadConfig(withEnv: Partial<EnvMap>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(withEnv)) {
    if (typeof value === "string") vi.stubEnv(key, value);
  }
  return import("./config");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("VITE_SHARIBO_CONTRACT_ID", () => {
  it("accepts a valid 56-char contract ID", async () => {
    const mod = await loadConfig(VALID);
    expect(mod.configError).toEqual([]);
  });

  it("rejects a real 56-char ID with a '0' (not in the base32 alphabet)", async () => {
    const withZero = `C${"A".repeat(30)}0${"A".repeat(24)}`;
    const mod = await loadConfig({ ...VALID, [CONTRACT]: withZero });
    expect(mod.configError).toEqual([
      `VITE_SHARIBO_CONTRACT_ID — invalid shape (got "${withZero}"; ${CONTRACT_SHAPE_SUFFIX})`,
    ]);
  });

  it("rejects a real 56-char ID with a '1' (not in the base32 alphabet)", async () => {
    const withOne = `C${"A".repeat(30)}1${"A".repeat(24)}`;
    const mod = await loadConfig({ ...VALID, [CONTRACT]: withOne });
    expect(mod.configError).toEqual([
      `VITE_SHARIBO_CONTRACT_ID — invalid shape (got "${withOne}"; ${CONTRACT_SHAPE_SUFFIX})`,
    ]);
  });

  it("rejects a 55-char ID (too short)", async () => {
    const short = `C${"A".repeat(54)}`; // length 55
    const mod = await loadConfig({ ...VALID, [CONTRACT]: short });
    expect(mod.configError).toEqual([
      `VITE_SHARIBO_CONTRACT_ID — invalid shape (got "${short}"; ${CONTRACT_SHAPE_SUFFIX})`,
    ]);
  });

  it("rejects a lowercase-prefixed ID", async () => {
    const lower = `c${"A".repeat(55)}`; // length 56 but starts lowercase
    const mod = await loadConfig({ ...VALID, [CONTRACT]: lower });
    expect(mod.configError).toEqual([
      `VITE_SHARIBO_CONTRACT_ID — invalid shape (got "${lower}"; ${CONTRACT_SHAPE_SUFFIX})`,
    ]);
  });

  it("accepts an ID built purely from [A-Z2-7]", async () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const id = `C${(alphabet + alphabet).slice(0, 55)}`;
    const mod = await loadConfig({ ...VALID, [CONTRACT]: id });
    expect(mod.configError).toEqual([]);
  });

  it("reports missing", async () => {
    const mod = await loadConfig({ ...VALID, [CONTRACT]: undefined });
    expect(mod.configError).toEqual(["VITE_SHARIBO_CONTRACT_ID — missing or empty"]);
  });

  it("reports empty", async () => {
    const mod = await loadConfig({ ...VALID, [CONTRACT]: "" });
    expect(mod.configError).toEqual(["VITE_SHARIBO_CONTRACT_ID — missing or empty"]);
  });
});

describe("VITE_STELLAR_RPC_URL", () => {
  it("reports missing", async () => {
    const mod = await loadConfig({ ...VALID, [RPC]: undefined });
    expect(mod.configError).toEqual(["VITE_STELLAR_RPC_URL — missing or empty"]);
  });

  it("reports empty", async () => {
    const mod = await loadConfig({ ...VALID, [RPC]: "" });
    expect(mod.configError).toEqual(["VITE_STELLAR_RPC_URL — missing or empty"]);
  });

  it("rejects a non-URL string", async () => {
    const notAUrl = "not a url";
    const mod = await loadConfig({ ...VALID, [RPC]: notAUrl });
    expect(mod.configError).toEqual([
      `VITE_STELLAR_RPC_URL — invalid URL (got "${notAUrl}"; expected an http/https URL)`,
    ]);
  });

  it("rejects a non-http(s) scheme", async () => {
    const ftp = "ftp://example.com";
    const mod = await loadConfig({ ...VALID, [RPC]: ftp });
    expect(mod.configError).toEqual([
      `VITE_STELLAR_RPC_URL — invalid URL (got "${ftp}"; expected an http/https URL)`,
    ]);
  });

  it("accepts an https URL", async () => {
    const mod = await loadConfig({ ...VALID, [RPC]: "https://soroban-testnet.stellar.org" });
    expect(mod.configError).toEqual([]);
  });

  it("accepts an http URL (non-TLS)", async () => {
    const mod = await loadConfig({ ...VALID, [RPC]: "http://localhost:8000" });
    expect(mod.configError).toEqual([]);
  });
});

describe("VITE_STELLAR_NETWORK_PASSPHRASE", () => {
  it("reports missing", async () => {
    const mod = await loadConfig({ ...VALID, [PASSPHRASE]: undefined });
    expect(mod.configError).toEqual(["VITE_STELLAR_NETWORK_PASSPHRASE — missing or empty"]);
  });

  it("reports empty", async () => {
    const mod = await loadConfig({ ...VALID, [PASSPHRASE]: "" });
    expect(mod.configError).toEqual(["VITE_STELLAR_NETWORK_PASSPHRASE — missing or empty"]);
  });

  it("accepts any non-empty value (no shape check)", async () => {
    const mod = await loadConfig({ ...VALID, [PASSPHRASE]: "Public Global Stellar Network ; September 2015" });
    expect(mod.configError).toEqual([]);
  });
});

describe("VITE_TEST_TOKEN_CONTRACT_ID", () => {
  it("accepts a valid 56-char contract ID", async () => {
    const mod = await loadConfig(VALID);
    expect(mod.configError).toEqual([]);
  });

  it("rejects a 55-char ID", async () => {
    const short = `C${"B".repeat(54)}`;
    const mod = await loadConfig({ ...VALID, [TOKEN]: short });
    expect(mod.configError).toEqual([
      `VITE_TEST_TOKEN_CONTRACT_ID — invalid shape (got "${short}"; ${CONTRACT_SHAPE_SUFFIX})`,
    ]);
  });

  it("rejects an ID containing '0'", async () => {
    const withZero = `C${"B".repeat(30)}0${"B".repeat(24)}`;
    const mod = await loadConfig({ ...VALID, [TOKEN]: withZero });
    expect(mod.configError).toEqual([
      `VITE_TEST_TOKEN_CONTRACT_ID — invalid shape (got "${withZero}"; ${CONTRACT_SHAPE_SUFFIX})`,
    ]);
  });

  it("reports missing", async () => {
    const mod = await loadConfig({ ...VALID, [TOKEN]: undefined });
    expect(mod.configError).toEqual(["VITE_TEST_TOKEN_CONTRACT_ID — missing or empty"]);
  });

  it("reports empty", async () => {
    const mod = await loadConfig({ ...VALID, [TOKEN]: "" });
    expect(mod.configError).toEqual(["VITE_TEST_TOKEN_CONTRACT_ID — missing or empty"]);
  });
});

describe("aggregate behavior", () => {
  it("reports all four problems when every variable is missing", async () => {
    const mod = await loadConfig({});
    expect(mod.configError).toEqual([
      "VITE_SHARIBO_CONTRACT_ID — missing or empty",
      "VITE_STELLAR_RPC_URL — missing or empty",
      "VITE_STELLAR_NETWORK_PASSPHRASE — missing or empty",
      "VITE_TEST_TOKEN_CONTRACT_ID — missing or empty",
    ]);
    expect(mod.config).toBeNull();
  });

  it("reports only the problems that actually exist (one invalid, rest valid)", async () => {
    const mod = await loadConfig({ ...VALID, [RPC]: "not a url" });
    expect(mod.configError).toEqual([
      `VITE_STELLAR_RPC_URL — invalid URL (got "not a url"; expected an http/https URL)`,
    ]);
    expect(mod.config).toBeNull();
  });

  it("populates config and keeps errors empty for a fully valid build", async () => {
    const mod = await loadConfig(VALID);
    expect(mod.configError).toEqual([]);
    expect(mod.config).toEqual(EXPECTED_CONFIG);
  });

  it("exported config is null (not an empty fake object) when validation fails", async () => {
    const mod = await loadConfig({ ...VALID, [TOKEN]: undefined });
    // The type-safety sharp edge: config must be null here, never `{...}`,
    // so the type system forces callers to check configError first.
    expect(mod.config).toBeNull();
    expect(mod.configError.length).toBeGreaterThan(0);
  });

  it("validate() returns the same result the module baked at load time", async () => {
    const mod = await loadConfig(VALID);
    const result = mod.validate();
    expect(result.errors).toEqual([]);
    expect(result.config).toEqual(EXPECTED_CONFIG);

    // Clear the validated env stubbed above so the broken case reads as missing.
    vi.unstubAllEnvs();
    const broken = await loadConfig({});
    const brokenResult = broken.validate();
    expect(brokenResult.config).toBeNull();
    expect(brokenResult.errors.length).toBe(4);
  });
});