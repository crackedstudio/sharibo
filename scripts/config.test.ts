import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { validate } from "./config.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let fixtureDir: string;
let envPath: string;

beforeEach(() => {
  fixtureDir = mkdtempSync(path.join(tmpdir(), "sharibo-config-test-"));
  envPath = path.join(fixtureDir, ".env");
});

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

function writeEnv(content: string) {
  writeFileSync(envPath, content, "utf8");
}

async function loadConfigSubprocess(
  envContent: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  writeEnv(envContent);
  const script = `
    import path from 'node:path';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const configPath = path.join(__dirname, 'config.ts');
    const configUrl = pathToFileURL(configPath).href;
    try {
      await import(configUrl);
      console.log('CONFIG_LOADED');
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  `;
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx/esm", "--eval", script],
      { cwd: __dirname, timeout: 10_000, env: { ...process.env, SHARIBO_ENV_FILE: envPath } },
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout || "",
      stderr: e.stderr || "",
      exitCode: e.code || 1,
    };
  }
}

describe("config loader", () => {
  const validEnvRecord: Record<string, string> = {
    STELLAR_RPC_URL: "https://rpc.invalid",
    STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    TEST_TOKEN_CONTRACT_ID: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4",
    SHARIBO_CONTRACT_ID: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBN7DY",
    ADMIN_SECRET_KEY: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABGVV",
  };

  it("loads successfully with all valid values", () => {
    const { config, errors } = validate(validEnvRecord);
    assert.deepEqual(errors, []);
    assert.ok(config);
  });

  it("fails when STELLAR_RPC_URL is missing", () => {
    const { errors } = validate({ ...validEnvRecord, STELLAR_RPC_URL: undefined });
    assert.match(errors[0], /STELLAR_RPC_URL.*missing or empty/);
  });

  it("fails when STELLAR_RPC_URL is empty", () => {
    const { errors } = validate({ ...validEnvRecord, STELLAR_RPC_URL: "   " });
    assert.match(errors[0], /STELLAR_RPC_URL.*missing or empty/);
  });

  it("fails when STELLAR_RPC_URL is malformed", () => {
    const { errors } = validate({ ...validEnvRecord, STELLAR_RPC_URL: "notaurl" });
    assert.match(errors[0], /STELLAR_RPC_URL.*not a valid HTTP\(S\) URL/);
  });

  it("fails when STELLAR_NETWORK_PASSPHRASE is missing", () => {
    const { errors } = validate({ ...validEnvRecord, STELLAR_NETWORK_PASSPHRASE: undefined });
    assert.match(errors[0], /STELLAR_NETWORK_PASSPHRASE.*missing or empty/);
  });

  it("fails when STELLAR_NETWORK_PASSPHRASE is empty", () => {
    const { errors } = validate({ ...validEnvRecord, STELLAR_NETWORK_PASSPHRASE: "" });
    assert.match(errors[0], /STELLAR_NETWORK_PASSPHRASE.*missing or empty/);
  });

  it("fails when STELLAR_NETWORK_PASSPHRASE is whitespace only", () => {
    const { errors } = validate({ ...validEnvRecord, STELLAR_NETWORK_PASSPHRASE: "   \\t" });
    assert.match(errors[0], /STELLAR_NETWORK_PASSPHRASE.*missing or empty/);
  });

  it("fails when TEST_TOKEN_CONTRACT_ID is missing", () => {
    const { errors } = validate({ ...validEnvRecord, TEST_TOKEN_CONTRACT_ID: undefined });
    assert.match(errors[0], /TEST_TOKEN_CONTRACT_ID.*missing or empty/);
  });

  it("fails when TEST_TOKEN_CONTRACT_ID is empty", () => {
    const { errors } = validate({ ...validEnvRecord, TEST_TOKEN_CONTRACT_ID: "" });
    assert.match(errors[0], /TEST_TOKEN_CONTRACT_ID.*missing or empty/);
  });

  it("fails when TEST_TOKEN_CONTRACT_ID is whitespace only", () => {
    const { errors } = validate({ ...validEnvRecord, TEST_TOKEN_CONTRACT_ID: "   " });
    assert.match(errors[0], /TEST_TOKEN_CONTRACT_ID.*missing or empty/);
  });

  it("fails when TEST_TOKEN_CONTRACT_ID is malformed (wrong prefix)", () => {
    const { errors } = validate({
      ...validEnvRecord,
      TEST_TOKEN_CONTRACT_ID: "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABGVV",
    });
    assert.match(
      errors[0],
      /TEST_TOKEN_CONTRACT_ID.*not a valid Stellar contract ID.*should start with 'C'/,
    );
  });

  it("fails when TEST_TOKEN_CONTRACT_ID is malformed (wrong length)", () => {
    const { errors } = validate({ ...validEnvRecord, TEST_TOKEN_CONTRACT_ID: "C123" });
    assert.match(
      errors[0],
      /TEST_TOKEN_CONTRACT_ID.*not a valid Stellar contract ID.*56 characters/,
    );
  });

  it("fails when SHARIBO_CONTRACT_ID is missing", () => {
    const { errors } = validate({ ...validEnvRecord, SHARIBO_CONTRACT_ID: undefined });
    assert.match(errors[0], /SHARIBO_CONTRACT_ID.*missing or empty/);
  });

  it("fails when SHARIBO_CONTRACT_ID is empty", () => {
    const { errors } = validate({ ...validEnvRecord, SHARIBO_CONTRACT_ID: "" });
    assert.match(errors[0], /SHARIBO_CONTRACT_ID.*missing or empty/);
  });

  it("fails when SHARIBO_CONTRACT_ID is malformed (wrong prefix)", () => {
    const { errors } = validate({
      ...validEnvRecord,
      SHARIBO_CONTRACT_ID: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABGVV",
    });
    assert.match(
      errors[0],
      /SHARIBO_CONTRACT_ID.*not a valid Stellar contract ID.*should start with 'C'/,
    );
  });

  it("fails when SHARIBO_CONTRACT_ID is malformed (wrong length)", () => {
    const { errors } = validate({ ...validEnvRecord, SHARIBO_CONTRACT_ID: "CSHORT" });
    assert.match(errors[0], /SHARIBO_CONTRACT_ID.*not a valid Stellar contract ID.*56 characters/);
  });

  it("fails when ADMIN_SECRET_KEY is missing", () => {
    const { errors } = validate({ ...validEnvRecord, ADMIN_SECRET_KEY: undefined });
    assert.match(errors[0], /ADMIN_SECRET_KEY.*missing or empty/);
  });

  it("fails when ADMIN_SECRET_KEY is empty", () => {
    const { errors } = validate({ ...validEnvRecord, ADMIN_SECRET_KEY: "" });
    assert.match(errors[0], /ADMIN_SECRET_KEY.*missing or empty/);
  });

  it("validates ADMIN_SECRET_KEY starts with 'S' (not 'G' or 'C')", () => {
    const { errors } = validate({
      ...validEnvRecord,
      ADMIN_SECRET_KEY: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABGVV",
    });
    assert.match(
      errors[0],
      /ADMIN_SECRET_KEY.*not a valid Stellar secret key.*should start with 'S'/,
    );
  });

  it("validates ADMIN_SECRET_KEY is 56 characters long", () => {
    const { errors } = validate({ ...validEnvRecord, ADMIN_SECRET_KEY: "SSHORT" });
    assert.match(errors[0], /ADMIN_SECRET_KEY.*not a valid Stellar secret key.*56 characters/);
  });

  it("CRITICAL: secret key never appears in error message when missing", () => {
    const { errors } = validate({ ...validEnvRecord, ADMIN_SECRET_KEY: undefined });
    const stderr = errors.join("\n");
    assert.match(stderr, /ADMIN_SECRET_KEY/);
    const secretValue = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABGVV";
    assert.doesNotMatch(stderr, new RegExp(secretValue.slice(0, 20)));
  });

  it("CRITICAL: secret key never appears in error message when malformed", () => {
    const secretValue = "SMALFORMEDKEY12345678901234567890123456789012345678";
    const { errors } = validate({ ...validEnvRecord, ADMIN_SECRET_KEY: secretValue });
    const stderr = errors.join("\n");
    assert.match(stderr, /ADMIN_SECRET_KEY/);
    assert.doesNotMatch(stderr, new RegExp(secretValue));
  });

  it("CRITICAL: contract IDs appear in error messages but secrets do not", () => {
    const contractId = "CBADCONTRACTID00000000000000000000000000000000000000";
    const secretKey = "SSECRETKEYSHOULDBEHIDDEN0000000000000000000000000000";
    const { errors } = validate({
      ...validEnvRecord,
      TEST_TOKEN_CONTRACT_ID: contractId,
      ADMIN_SECRET_KEY: secretKey,
    });
    const stderr = errors.join("\n");
    assert.match(stderr, new RegExp(contractId));
    assert.doesNotMatch(stderr, new RegExp(secretKey));
  });

  it("aggregates multiple errors into one message", () => {
    const { errors } = validate({
      STELLAR_RPC_URL: "notaurl",
      STELLAR_NETWORK_PASSPHRASE: "",
      TEST_TOKEN_CONTRACT_ID: "BADID",
      SHARIBO_CONTRACT_ID: undefined,
      ADMIN_SECRET_KEY: "GNOTASECRET0000000000000000000000000000000000000000",
    });
    assert.equal(errors.length, 5);
    const stderr = errors.join("\n");
    assert.match(stderr, /STELLAR_RPC_URL/);
    assert.match(stderr, /STELLAR_NETWORK_PASSPHRASE/);
    assert.match(stderr, /TEST_TOKEN_CONTRACT_ID/);
    assert.match(stderr, /SHARIBO_CONTRACT_ID/);
    assert.match(stderr, /ADMIN_SECRET_KEY/);
  });

  it("real behaviour: importing the module with a broken env throws/exits", async () => {
    const env = ""; // completely empty
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(stderr, /Environment validation failed/);
    assert.match(stderr, /\.env\.example/);
    assert.match(stderr, /scripts\/config\.ts/);
    assert.match(stderr, /5 variable/);
  });
});
