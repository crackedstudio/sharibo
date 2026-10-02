// Unit tests for the smoke probe's diagnostic logic.
//
// Hermetic: `smoke.ts` is spawned as a subprocess (it validates env and
// `process.exit`s at module load, so it cannot be imported), and every
// endpoint it is pointed at is a local `http.createServer` started by this
// file. Nothing here reaches the public internet, friendbot, or testnet —
// `npm run smoke` is the live probe, deliberately kept out of this suite.

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { NETWORKS } from "@sharibo/client";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A syntactically valid contract ID (56 chars, 'C' prefix) that is not deployed
// anywhere. Used where a value only has to be well-formed.
const BOGUS_CONTRACT_ID = "CBOGUS000000000000000000000000000000000000000000000000000";

// ---- Local stand-in for the Soroban RPC + Horizon endpoints ----
//
// A real http.createServer rather than a mocked `fetch`, because the code
// under test runs in a child process: there is no way to inject a stub into
// it, so the only hermetic option is to give it a real socket to talk to.

let server: Server;
let baseUrl: string;
let requests: string[] = [];

before(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "/";
    requests.push(url);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url === "/health") {
      // The shape smoke.ts reads: it only checks `status === "healthy"`.
      return send(200, { status: "healthy", latestLedger: 1, protocolVersion: 22 });
    }
    if (url === "/" || url === "") {
      // Horizon root; smoke.ts only reads `horizon_version`.
      return send(200, {
        horizon_version: "2.27.0",
        network_passphrase: NETWORKS.testnet.passphrase,
        _links: { self: { href: baseUrl } },
      });
    }
    // Anything else is a Soroban JSON-RPC call (getLedgerEntries, getEvents,
    // …) that this fake has no business answering. A 404 is a deterministic
    // failure for the SDK to surface.
    return send(404, { status: 404, title: "Not Found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  requests = [];
});

afterEach(() => {
  requests = [];
});

// Each test gets a fresh temp directory containing a single `.env`
// fixture, and smoke.ts is pointed at it via SHARIBO_ENV_FILE. The previous
// version wrote the developer's real repo-root `.env` and restored it
// afterwards, which made this file race against config.test.ts (node --test
// runs files in parallel) and would clobber a real .env for good if the
// process died mid-run.
let fixtureDir: string;
let envPath: string;

function writeEnv(content: string) {
  writeFileSync(envPath, content, "utf8");
}

// `process.loadEnvFile` never overwrites a variable that is already set, so any
// STELLAR_/SHARIBO_/ADMIN_/TEST_TOKEN_ value in the ambient environment would
// silently beat the fixture. Clear them for the duration of the test and put
// them back afterwards.
const AMBIENT_PREFIXES = /^(STELLAR_|SHARIBO_|ADMIN_|TEST_TOKEN_)/;
let ambientBackup: [string, string | undefined][] = [];

beforeEach(() => {
  fixtureDir = mkdtempSync(path.join(tmpdir(), "sharibo-smoke-test-"));
  envPath = path.join(fixtureDir, ".env");

  ambientBackup = Object.keys(process.env)
    .filter((k) => AMBIENT_PREFIXES.test(k))
    .map((k) => [k, process.env[k]]);
  for (const [k] of ambientBackup) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of ambientBackup) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  ambientBackup = [];

  rmSync(fixtureDir, { recursive: true, force: true });
});

/**
 * Run smoke.ts against the local server.
 *
 * Any ambient STELLAR_/SHARIBO_/ADMIN_/TEST_TOKEN_ variables are cleared from
 * this process first, because `process.loadEnvFile` does not overwrite
 * variables that are already set — without this, a value in the developer's
 * shell (or in CI) would silently win over the `.env` the test just wrote.
 *
 * Note this mutates `process.env` rather than handing `execFile` a filtered
 * `env` object: on Windows, spawning `npx` with a custom environment fails
 * with ENOENT, because the .cmd shim is resolved against the original
 * environment block.
 */
async function runSmoke(
  envContent: string,
  extraArgs: string[] = [],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  writeEnv(envContent);
  try {
    // Spawn node with the tsx loader directly rather than "npx tsx": npx is a
    // .cmd shim on Windows and execFile cannot spawn one without a shell, so
    // every call failed with ENOENT and the assertions ran against empty
    // output. Same invocation config.test.ts already uses.
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", "tsx/esm", path.join(__dirname, "smoke.ts"), ...extraArgs],
      {
        cwd: __dirname,
        timeout: 30_000,
        env: { ...process.env, SHARIBO_ENV_FILE: envPath },
      },
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

const localEnv = (extra: string[] = []) =>
  [
    `STELLAR_RPC_URL=${baseUrl}`,
    `STELLAR_HORIZON_URL=${baseUrl}`,
    `STELLAR_NETWORK_PASSPHRASE="${NETWORKS.testnet.passphrase}"`,
    ...extra,
    "",
  ].join("\n");

describe("smoke test", () => {
  it("shows help with --help flag", async () => {
    const { stdout, exitCode } = await runSmoke(localEnv(), ["--help"]);
    assert.match(stdout, /Usage:/);
    assert.match(stdout, /--circle-id/);
    assert.equal(exitCode, 0);
  });

  it("fails when STELLAR_RPC_URL is missing", async () => {
    const { stdout, exitCode } = await runSmoke(
      `STELLAR_NETWORK_PASSPHRASE=test\nSHARIBO_CONTRACT_ID=${BOGUS_CONTRACT_ID}\n`,
    );
    assert.match(stdout, /STELLAR_RPC_URL is not set/);
    assert.equal(exitCode, 1);
  });

  it("fails when SHARIBO_CONTRACT_ID is missing", async () => {
    const { stdout, exitCode } = await runSmoke(
      [
        `STELLAR_RPC_URL=${baseUrl}`,
        `STELLAR_NETWORK_PASSPHRASE="${NETWORKS.testnet.passphrase}"`,
        "",
      ].join("\n"),
    );
    assert.match(stdout, /SHARIBO_CONTRACT_ID is not set/);
    assert.equal(exitCode, 1);
  });

  it("reports the RPC and Horizon checks as healthy against a reachable server", async () => {
    // This is the positive path that the old live-network version could never
    // assert deterministically: with the old setup, a flaky or blocked
    // network made this test's outcome depend on the environment.
    const { stdout } = await runSmoke(localEnv([`SHARIBO_CONTRACT_ID=${BOGUS_CONTRACT_ID}`]));

    assert.match(stdout, /\[OK\] Soroban RPC health: healthy/);
    assert.match(stdout, /\[OK\] Horizon root: Horizon v2\.27\.0/);
    assert.ok(requests.includes("/health"), "the probe should have called the RPC health endpoint");
  });

  it("detects a bogus contract ID gracefully", async () => {
    const { stdout, exitCode } = await runSmoke(
      localEnv([`SHARIBO_CONTRACT_ID=${BOGUS_CONTRACT_ID}`]),
    );

    // Should fail gracefully (not crash) with a meaningful message
    assert.equal(exitCode, 1);
    assert.match(stdout, /FAIL/);
    assert.doesNotMatch(stdout, /UnhandledPromiseRejection|at Object\.<anonymous>/);
  });

  it("accepts --circle-id flag without crashing", async () => {
    const { stdout, exitCode } = await runSmoke(
      localEnv([`SHARIBO_CONTRACT_ID=${BOGUS_CONTRACT_ID}`]),
      ["--circle-id", "5"],
    );
    // Should attempt to check circle 5 and fail gracefully
    assert.match(stdout, /getCircle\(5\)/);
    assert.equal(exitCode, 1);
  });
});
