// Read-only smoke test: verify deployment health without spending funds.
//
// Usage: npm run smoke                      (default: circle 0)
//        npm run smoke -- --circle-id 3     (check a specific circle)
//
// Checks: (1) RPC health, (2) Horizon root, (3) getCircle on the contract.
// No transactions, no keys needed beyond .env contract IDs.

import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.join(__dirname, "..", ".env"));

const RPC_URL = process.env.STELLAR_RPC_URL;
const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE;
const CONTRACT_ID = process.env.SHARIBO_CONTRACT_ID;

// --- flag parsing (node:util, no new deps) ---
const { values } = parseArgs({
  options: {
    "circle-id": { type: "string", default: "0" },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`Usage: npm run smoke [-- --circle-id <id>]

Options:
  --circle-id <id>   Circle ID to check (default: 0)
  -h, --help         Show this help message`);
  process.exit(0);
}

const circleId = BigInt(values["circle-id"]!);

// --- diagnostics ---

interface DiagResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function checkRpcHealth(): Promise<DiagResult> {
  const name = "Soroban RPC health";
  if (!RPC_URL) {
    return { name, ok: false, detail: "STELLAR_RPC_URL is not set in .env" };
  }
  try {
    const res = await fetch(`${RPC_URL}/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { name, ok: false, detail: `HTTP ${res.status} from ${RPC_URL}/health` };
    }
    const body = await res.json();
    const status = (body as { status?: string }).status;
    if (status !== "healthy") {
      return { name, ok: false, detail: `RPC status: "${status}" (expected "healthy")` };
    }
    return { name, ok: true, detail: `healthy (${RPC_URL})` };
  } catch (err) {
    return { name, ok: false, detail: `RPC unreachable: ${(err as Error).message}` };
  }
}

async function checkHorizon(): Promise<DiagResult> {
  const name = "Horizon root";
  try {
    const res = await fetch(HORIZON_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { name, ok: false, detail: `HTTP ${res.status} from ${HORIZON_URL}` };
    }
    const body = await res.json();
    const version = (body as { horizon_version?: string }).horizon_version;
    return { name, ok: true, detail: `Horizon v${version} (${HORIZON_URL})` };
  } catch (err) {
    return { name, ok: false, detail: `Horizon unreachable: ${(err as Error).message}` };
  }
}

async function checkCircle(): Promise<DiagResult> {
  const name = `getCircle(${circleId})`;

  if (!CONTRACT_ID) {
    return {
      name,
      ok: false,
      detail:
        "SHARIBO_CONTRACT_ID is not set in .env. Did you deploy the contract? See README § Contract.",
    };
  }
  if (!NETWORK_PASSPHRASE) {
    return {
      name,
      ok: false,
      detail: "STELLAR_NETWORK_PASSPHRASE is not set in .env",
    };
  }
  if (!RPC_URL) {
    return {
      name,
      ok: false,
      detail: "STELLAR_RPC_URL is not set in .env",
    };
  }

  try {
    // Dynamic import so env-missing paths above exit before this resolution.
    const { Keypair } = await import("@stellar/stellar-sdk");
    const { ShariboSDK } = await import("@sharibo/client");

    // The SDK uses a keypair to sign; this is a read-only call, so the
    // random keypair is discarded without anything being submitted.
    const throwaway = Keypair.random();
    const sdk = await ShariboSDK.connect(
      { contractId: CONTRACT_ID, rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE },
      throwaway,
    );
    const circle = await sdk.getCircle(circleId);

    const lines = [
      `round: ${circle.round}`,
      `pot: ${circle.pot} stroops`,
      `size: ${circle.size}`,
      `contribution: ${circle.contribution} stroops`,
    ];
    return { name, ok: true, detail: lines.join(", ") };
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("Error(Contract, #1)") || msg.includes("not found")) {
      return {
        name,
        ok: false,
        detail: `Contract or circle not found. Testnet may have been reset — redeploy with \`stellar contract deploy\`. See README § Contract.`,
      };
    }
    return { name, ok: false, detail: msg.split("\n")[0] };
  }
}

// --- main ---

async function main() {
  console.log("Sharibo smoke test\n");

  const results = await Promise.all([
    checkRpcHealth(),
    checkHorizon(),
    checkCircle(),
  ]);

  let allOk = true;
  for (const r of results) {
    const icon = r.ok ? "OK" : "FAIL";
    console.log(`  [${icon}] ${r.name}: ${r.detail}`);
    if (!r.ok) allOk = false;
  }

  console.log();
  if (allOk) {
    console.log("All checks passed — deployment looks healthy.");
  } else {
    console.log("Some checks failed — see details above.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(1);
});
