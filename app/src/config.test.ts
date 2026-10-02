/**
 * Tests for app/src/config.ts — the gate between the app and a misconfigured
 * deployment.
 *
 * `config.ts` exposes a pure `validate()` function that allows us to run
 * configuration testing in-process without reloading the module.
 */
import { describe, it, expect } from "vitest";
import { validate } from "./config";

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

const CONTRACT_SHAPE_SUFFIX = "expected a 56-character Stellar contract ID starting with 'C'";

describe("VITE_SHARIBO_CONTRACT_ID", () => {
  it("accepts a valid 56-char contract ID", () => {
    const { errors } = validate(VALID);
    expect(errors).toEqual([]);
  });

  it("rejects a real 56-char ID with a '0' (not in the base32 alphabet)", () => {
    const withZero = `C${"A".repeat(30)}0${"A".repeat(24)}`;
    const { errors } = validate({ ...VALID, [CONTRACT]: withZero });
    expect(errors).toEqual([
      `VITE_SHARIBO_CONTRACT_ID — invalid shape (got "${withZero}"; ${CONTRACT_SHAPE_SUFFIX})`,
    ]);
  });

  it("rejects a real 56-char ID with a '1' (not in the base32 alphabet)", () => {
    const withOne = `C${"A".repeat(30)}1${"A".repeat(24)}`;
    const { errors } = validate({ ...VALID, [CONTRACT]: withOne });
    expect(errors).toEqual([
      `VITE_SHARIBO_CONTRACT_ID — invalid shape (got "${withOne}"; ${CONTRACT_SHAPE_SUFFIX})`,
    ]);
  });

  it("rejects a 55-char ID (too short)", () => {
    const short = `C${"A".repeat(54)}`; // length 55
    const { errors } = validate({ ...VALID, [CONTRACT]: short });
    expect(errors).toEqual([
      `VITE_SHARIBO_CONTRACT_ID — invalid shape (got "${short}"; ${CONTRACT_SHAPE_SUFFIX})`,
    ]);
  });

  it("rejects a lowercase-prefixed ID", () => {
    const lower = `c${"A".repeat(55)}`; // length 56 but starts lowercase
    const { errors } = validate({ ...VALID, [CONTRACT]: lower });
    expect(errors).toEqual([
      `VITE_SHARIBO_CONTRACT_ID — invalid shape (got "${lower}"; ${CONTRACT_SHAPE_SUFFIX})`,
    ]);
  });

  it("accepts an ID built purely from [A-Z2-7]", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const id = `C${(alphabet + alphabet).slice(0, 55)}`;
    const { errors } = validate({ ...VALID, [CONTRACT]: id });
    expect(errors).toEqual([]);
  });

  it("reports missing", () => {
    const { errors } = validate({ ...VALID, [CONTRACT]: undefined });
    expect(errors).toEqual(["VITE_SHARIBO_CONTRACT_ID — missing or empty"]);
  });

  it("reports empty", () => {
    const { errors } = validate({ ...VALID, [CONTRACT]: "" });
    expect(errors).toEqual(["VITE_SHARIBO_CONTRACT_ID — missing or empty"]);
  });

  it("reports empty when whitespace only", () => {
    const { errors } = validate({ ...VALID, [CONTRACT]: "   " });
    expect(errors).toEqual(["VITE_SHARIBO_CONTRACT_ID — missing or empty"]);
  });
});

describe("VITE_STELLAR_RPC_URL", () => {
  it("reports missing", () => {
    const { errors } = validate({ ...VALID, [RPC]: undefined });
    expect(errors).toEqual(["VITE_STELLAR_RPC_URL — missing or empty"]);
  });

  it("reports empty", () => {
    const { errors } = validate({ ...VALID, [RPC]: "" });
    expect(errors).toEqual(["VITE_STELLAR_RPC_URL — missing or empty"]);
  });

  it("reports empty when whitespace only", () => {
    const { errors } = validate({ ...VALID, [RPC]: "  " });
    expect(errors).toEqual(["VITE_STELLAR_RPC_URL — missing or empty"]);
  });

  it("rejects a non-URL string", () => {
    const notAUrl = "not a url";
    const { errors } = validate({ ...VALID, [RPC]: notAUrl });
    expect(errors).toEqual([
      `VITE_STELLAR_RPC_URL — invalid URL (got "${notAUrl}"; expected an http/https URL)`,
    ]);
  });

  it("rejects a non-http(s) scheme", () => {
    const ftp = "ftp://example.com";
    const { errors } = validate({ ...VALID, [RPC]: ftp });
    expect(errors).toEqual([
      `VITE_STELLAR_RPC_URL — invalid URL (got "${ftp}"; expected an http/https URL)`,
    ]);
  });

  it("accepts an https URL", () => {
    const { errors } = validate({ ...VALID, [RPC]: "https://soroban-testnet.stellar.org" });
    expect(errors).toEqual([]);
  });

  it("accepts an http URL (non-TLS)", () => {
    const { errors } = validate({ ...VALID, [RPC]: "http://localhost:8000" });
    expect(errors).toEqual([]);
  });
});

describe("VITE_STELLAR_NETWORK_PASSPHRASE", () => {
  it("reports missing", () => {
    const { errors } = validate({ ...VALID, [PASSPHRASE]: undefined });
    expect(errors).toEqual(["VITE_STELLAR_NETWORK_PASSPHRASE — missing or empty"]);
  });

  it("reports empty", () => {
    const { errors } = validate({ ...VALID, [PASSPHRASE]: "" });
    expect(errors).toEqual(["VITE_STELLAR_NETWORK_PASSPHRASE — missing or empty"]);
  });

  it("reports empty when whitespace only", () => {
    const { errors } = validate({ ...VALID, [PASSPHRASE]: "   \\t" });
    expect(errors).toEqual(["VITE_STELLAR_NETWORK_PASSPHRASE — missing or empty"]);
  });

  it("accepts any non-empty value (no shape check)", () => {
    const { errors } = validate({
      ...VALID,
      [PASSPHRASE]: "Public Global Stellar Network ; September 2015",
    });
    expect(errors).toEqual([]);
  });
});

describe("VITE_TEST_TOKEN_CONTRACT_ID", () => {
  it("accepts a valid 56-char contract ID", () => {
    const { errors } = validate(VALID);
    expect(errors).toEqual([]);
  });

  it("rejects a 55-char ID", () => {
    const short = `C${"B".repeat(54)}`;
    const { errors } = validate({ ...VALID, [TOKEN]: short });
    expect(errors).toEqual([
      `VITE_TEST_TOKEN_CONTRACT_ID — invalid shape (got "${short}"; ${CONTRACT_SHAPE_SUFFIX})`,
    ]);
  });

  it("rejects an ID containing '0'", () => {
    const withZero = `C${"B".repeat(30)}0${"B".repeat(24)}`;
    const { errors } = validate({ ...VALID, [TOKEN]: withZero });
    expect(errors).toEqual([
      `VITE_TEST_TOKEN_CONTRACT_ID — invalid shape (got "${withZero}"; ${CONTRACT_SHAPE_SUFFIX})`,
    ]);
  });

  it("reports missing", () => {
    const { errors } = validate({ ...VALID, [TOKEN]: undefined });
    expect(errors).toEqual(["VITE_TEST_TOKEN_CONTRACT_ID — missing or empty"]);
  });

  it("reports empty", () => {
    const { errors } = validate({ ...VALID, [TOKEN]: "" });
    expect(errors).toEqual(["VITE_TEST_TOKEN_CONTRACT_ID — missing or empty"]);
  });

  it("reports empty when whitespace only", () => {
    const { errors } = validate({ ...VALID, [TOKEN]: "   " });
    expect(errors).toEqual(["VITE_TEST_TOKEN_CONTRACT_ID — missing or empty"]);
  });
});

describe("aggregate behavior", () => {
  it("rejects a circle size larger than the circuit capacity", async () => {
    vi.stubEnv("LEVELS", "2");
    const mod = await loadConfig(VALID);
    expect(mod.configError).toContain(
      "CIRCLE_SIZE — 5 exceeds MAX_CIRCLE_SIZE (4) for TREE_LEVELS=2",
    );
    expect(mod.config).toBeNull();
  });

  it("reports all four problems when every variable is missing", async () => {
    const mod = await loadConfig({});
    expect(mod.configError).toEqual([
      "VITE_SHARIBO_CONTRACT_ID — missing or empty",
      "VITE_STELLAR_RPC_URL — missing or empty",
      "VITE_STELLAR_NETWORK_PASSPHRASE — missing or empty",
      "VITE_TEST_TOKEN_CONTRACT_ID — missing or empty",
    ]);
    expect(config).toBeNull();
  });

  it("reports only the problems that actually exist (one invalid, rest valid)", () => {
    const { config, errors } = validate({ ...VALID, [RPC]: "not a url" });
    expect(errors).toEqual([
      `VITE_STELLAR_RPC_URL — invalid URL (got "not a url"; expected an http/https URL)`,
    ]);
    expect(config).toBeNull();
  });

  it("populates config and keeps errors empty for a fully valid build", () => {
    const { config, errors } = validate(VALID);
    expect(errors).toEqual([]);
    expect(config).toEqual(EXPECTED_CONFIG);
  });

  it("exported config is null (not an empty fake object) when validation fails", () => {
    const { config, errors } = validate({ ...VALID, [TOKEN]: undefined });
    expect(config).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });
});
