// Unit tests for config.ts — the shared environment loader.
// These tests verify that missing, empty, or malformed values produce
// clear error messages before any network call, and that secret material
// never leaks into error output.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const envPath = path.join(rootDir, ".env");

// Backup/restore .env around tests since config.ts reads it eagerly on import.
let envBackup: string | null = null;

function writeEnv(content: string) {
  writeFileSync(envPath, content, "utf8");
}

beforeEach(() => {
  try {
    envBackup = readFileSync(envPath, "utf8");
  } catch {
    envBackup = null;
  }
});

afterEach(() => {
  if (envBackup !== null) {
    writeFileSync(envPath, envBackup, "utf8");
  } else if (existsSync(envPath)) {
    unlinkSync(envPath);
  }
});

/**
 * Helper to load config.ts as a subprocess and capture its output.
 * Since config.ts validates eagerly on import, a subprocess lets us
 * test validation errors without polluting the test process's state.
 */
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
      "node",
      ["--import", "tsx/esm", "--eval", script],
      { cwd: __dirname, timeout: 10_000 },
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
  // Valid minimal config for success tests
  const validEnv = [
    "STELLAR_RPC_URL=https://soroban-testnet.stellar.org",
    'STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"',
    "TEST_TOKEN_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4",
    "SHARIBO_CONTRACT_ID=CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBN7DY",
    "ADMIN_SECRET_KEY=SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABGVV",
  ].join("\n");

  it("loads successfully with all valid values", async () => {
    const { stdout, stderr, exitCode } = await loadConfigSubprocess(validEnv);
    assert.equal(exitCode, 0, `Expected success, got stderr: ${stderr}`);
    assert.match(stdout, /CONFIG_LOADED/);
  });

  it("fails when STELLAR_RPC_URL is missing", async () => {
    const env = validEnv.replace(/STELLAR_RPC_URL=.+\n/, "");
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(stderr, /STELLAR_RPC_URL.*missing or empty/);
  });

  it("fails when STELLAR_RPC_URL is empty", async () => {
    const env = validEnv.replace(
      /STELLAR_RPC_URL=.+/,
      "STELLAR_RPC_URL=   ",
    );
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(stderr, /STELLAR_RPC_URL.*missing or empty/);
  });

  it("fails when STELLAR_RPC_URL is malformed", async () => {
    const env = validEnv.replace(/STELLAR_RPC_URL=.+/, "STELLAR_RPC_URL=notaurl");
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(stderr, /STELLAR_RPC_URL.*not a valid HTTP\(S\) URL/);
  });

  it("fails when STELLAR_NETWORK_PASSPHRASE is missing", async () => {
    const env = validEnv.replace(/STELLAR_NETWORK_PASSPHRASE=.+\n/, "");
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(stderr, /STELLAR_NETWORK_PASSPHRASE.*missing or empty/);
  });

  it("fails when STELLAR_NETWORK_PASSPHRASE is empty", async () => {
    const env = validEnv.replace(
      /STELLAR_NETWORK_PASSPHRASE=.+/,
      "STELLAR_NETWORK_PASSPHRASE=",
    );
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(stderr, /STELLAR_NETWORK_PASSPHRASE.*missing or empty/);
  });

  it("fails when TEST_TOKEN_CONTRACT_ID is missing", async () => {
    const env = validEnv.replace(/TEST_TOKEN_CONTRACT_ID=.+\n/, "");
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(stderr, /TEST_TOKEN_CONTRACT_ID.*missing or empty/);
  });

  it("fails when TEST_TOKEN_CONTRACT_ID is empty", async () => {
    const env = validEnv.replace(/TEST_TOKEN_CONTRACT_ID=.+/, "TEST_TOKEN_CONTRACT_ID=");
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(stderr, /TEST_TOKEN_CONTRACT_ID.*missing or empty/);
  });

  it("fails when TEST_TOKEN_CONTRACT_ID is malformed (wrong prefix)", async () => {
    const env = validEnv.replace(
      /TEST_TOKEN_CONTRACT_ID=.+/,
      "TEST_TOKEN_CONTRACT_ID=SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABGVV",
    );
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(
      stderr,
      /TEST_TOKEN_CONTRACT_ID.*not a valid Stellar contract ID.*should start with 'C'/,
    );
  });

  it("fails when TEST_TOKEN_CONTRACT_ID is malformed (wrong length)", async () => {
    const env = validEnv.replace(/TEST_TOKEN_CONTRACT_ID=.+/, "TEST_TOKEN_CONTRACT_ID=C123");
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(
      stderr,
      /TEST_TOKEN_CONTRACT_ID.*not a valid Stellar contract ID.*56 characters/,
    );
  });

  it("fails when SHARIBO_CONTRACT_ID is missing", async () => {
    const env = validEnv.replace(/SHARIBO_CONTRACT_ID=.+\n/, "");
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(stderr, /SHARIBO_CONTRACT_ID.*missing or empty/);
  });

  it("fails when SHARIBO_CONTRACT_ID is empty", async () => {
    const env = validEnv.replace(/SHARIBO_CONTRACT_ID=.+/, "SHARIBO_CONTRACT_ID=");
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(stderr, /SHARIBO_CONTRACT_ID.*missing or empty/);
  });

  it("fails when SHARIBO_CONTRACT_ID is malformed (wrong prefix)", async () => {
    const env = validEnv.replace(
      /SHARIBO_CONTRACT_ID=.+/,
      "SHARIBO_CONTRACT_ID=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABGVV",
    );
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(
      stderr,
      /SHARIBO_CONTRACT_ID.*not a valid Stellar contract ID.*should start with 'C'/,
    );
  });

  it("fails when SHARIBO_CONTRACT_ID is malformed (wrong length)", async () => {
    const env = validEnv.replace(/SHARIBO_CONTRACT_ID=.+/, "SHARIBO_CONTRACT_ID=CSHORT");
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(
      stderr,
      /SHARIBO_CONTRACT_ID.*not a valid Stellar contract ID.*56 characters/,
    );
  });

  it("fails when ADMIN_SECRET_KEY is missing", async () => {
    const env = validEnv.replace(/ADMIN_SECRET_KEY=.+/, "");
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(stderr, /ADMIN_SECRET_KEY.*missing or empty/);
  });

  it("fails when ADMIN_SECRET_KEY is empty", async () => {
    const env = validEnv.replace(/ADMIN_SECRET_KEY=.+/, "ADMIN_SECRET_KEY=");
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(stderr, /ADMIN_SECRET_KEY.*missing or empty/);
  });

  it("validates ADMIN_SECRET_KEY starts with 'S' (not 'G' or 'C')", async () => {
    const env = validEnv.replace(
      /ADMIN_SECRET_KEY=.+/,
      "ADMIN_SECRET_KEY=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABGVV",
    );
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(
      stderr,
      /ADMIN_SECRET_KEY.*not a valid Stellar secret key.*should start with 'S'/,
    );
  });

  it("validates ADMIN_SECRET_KEY is 56 characters long", async () => {
    const env = validEnv.replace(/ADMIN_SECRET_KEY=.+/, "ADMIN_SECRET_KEY=SSHORT");
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(
      stderr,
      /ADMIN_SECRET_KEY.*not a valid Stellar secret key.*56 characters/,
    );
  });

  it("CRITICAL: secret key never appears in error message when missing", async () => {
    const secretValue = "SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABGVV";
    const env = validEnv.replace(/ADMIN_SECRET_KEY=.+/, "ADMIN_SECRET_KEY=");
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    // The error should mention ADMIN_SECRET_KEY but NOT echo the actual value
    assert.match(stderr, /ADMIN_SECRET_KEY/);
    assert.doesNotMatch(stderr, new RegExp(secretValue.slice(0, 20)));
  });

  it("CRITICAL: secret key never appears in error message when malformed", async () => {
    const secretValue = "SMALFORMEDKEY12345678901234567890123456789012345678";
    const env = validEnv.replace(/ADMIN_SECRET_KEY=.+/, `ADMIN_SECRET_KEY=${secretValue}`);
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    // The error should describe the problem but NOT echo the full secret
    assert.match(stderr, /ADMIN_SECRET_KEY/);
    // Allow the quoted fragment check, but ensure the secret itself isn't there
    assert.doesNotMatch(stderr, new RegExp(secretValue));
  });

  it("CRITICAL: contract IDs appear in error messages but secrets do not", async () => {
    const contractId = "CBADCONTRACTID00000000000000000000000000000000000000";
    const secretKey = "SSECRETKEYSHOULDBEHIDDEN0000000000000000000000000000";
    const env = [
      "STELLAR_RPC_URL=https://soroban-testnet.stellar.org",
      'STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"',
      `TEST_TOKEN_CONTRACT_ID=${contractId}`,
      "SHARIBO_CONTRACT_ID=CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBN7DY",
      `ADMIN_SECRET_KEY=${secretKey}`,
    ].join("\n");

    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    // Contract ID error should show the value (it's public, not secret)
    assert.match(stderr, new RegExp(contractId));
    // Secret key error should NOT show the value
    assert.doesNotMatch(stderr, new RegExp(secretKey));
  });

  it("aggregates multiple errors into one message", async () => {
    const env = [
      "STELLAR_RPC_URL=notaurl",
      "STELLAR_NETWORK_PASSPHRASE=",
      "TEST_TOKEN_CONTRACT_ID=BADID",
      // SHARIBO_CONTRACT_ID missing entirely
      "ADMIN_SECRET_KEY=GNOTASECRET0000000000000000000000000000000000000000",
    ].join("\n");

    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    // Should mention all five problems
    assert.match(stderr, /STELLAR_RPC_URL/);
    assert.match(stderr, /STELLAR_NETWORK_PASSPHRASE/);
    assert.match(stderr, /TEST_TOKEN_CONTRACT_ID/);
    assert.match(stderr, /SHARIBO_CONTRACT_ID/);
    assert.match(stderr, /ADMIN_SECRET_KEY/);
    // Should mention the count
    assert.match(stderr, /5 variable/);
  });

  it("strips surrounding quotes from env values", async () => {
    const env = [
      'STELLAR_RPC_URL="https://soroban-testnet.stellar.org"',
      "STELLAR_NETWORK_PASSPHRASE='Test SDF Network ; September 2015'",
      "TEST_TOKEN_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFCT4",
      "SHARIBO_CONTRACT_ID=CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBN7DY",
      "ADMIN_SECRET_KEY=SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABGVV",
    ].join("\n");

    const { stdout, stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 0, `Expected success with quoted values, got stderr: ${stderr}`);
    assert.match(stdout, /CONFIG_LOADED/);
  });

  it("points to .env.example in error message", async () => {
    const env = ""; // completely empty
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(stderr, /\.env\.example/);
  });

  it("mentions config.ts in error message for reference", async () => {
    const env = ""; // completely empty
    const { stderr, exitCode } = await loadConfigSubprocess(env);
    assert.equal(exitCode, 1);
    assert.match(stderr, /scripts\/config\.ts/);
  });
});
