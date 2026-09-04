// Full private round against Stellar testnet: create a 5-member circle,
// fund it from 5 distinct accounts, generate a real ZK proof for one member,
// claim the pot to a FRESH address unlinkable to any funder, then confirm a
// second claim with the same nullifier is rejected on-chain.
//
// Usage: npm run e2e   (from repo root, or `npm run e2e` inside scripts/)
//
// Flags (node:util parseArgs, no new deps):
//   --skip-replay         Stop after the successful claim (skip round 2 funding + replay check)
//   --reuse-circle <id>   Skip circle creation; run against an existing circle
//   --verbose             Echo each RPC/curl interaction
//
// Requires: circuits/build/{membership_js/membership.wasm,membership_final.zkey}
// (run circuits/scripts/{compile,setup}.sh first) and a populated .env.
//
// Parallelization strategy (see #97):
// - Friendbot funding: fully parallel via Promise.all (independent accounts).
// - Soroban fund txs: sequential. Each fund() call reads and writes the same
//   Circle storage entry (incrementing `funded_count` and `pot`). Parallel
//   submission causes footprint contention: the second-to-arrive tx simulates
//   against stale ledger state and is rejected by the RPC with a sequence or
//   footprint conflict. This was measured — not assumed — and the sequential
//   path is the deliberate choice.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";

const execFileAsync = promisify(execFile);
import { Keypair } from "@stellar/stellar-sdk";
import {
  generateIdentity,
  computeExternalNullifier,
  MerkleTree,
  generateProof,
  estimateClaimFee,
  verificationKeyToContractFormat,
  connect,
  createCircle,
  fund,
  claim,
  getCircle,
  TREE_LEVELS,
  ContractError,
} from "@sharibo/client";
import { checkContractDeployed } from "./testnet-health.js";

// --- CLI flag parsing (node:util parseArgs — no new deps) ---

const { values: flags } = parseArgs({
  options: {
    "skip-replay": { type: "boolean", default: false },
    "reuse-circle": { type: "string" },
    verbose: { type: "boolean", default: false },
  },
  strict: true,
});

const SKIP_REPLAY = flags["skip-replay"]!;
const REUSE_CIRCLE = flags["reuse-circle"] != null ? BigInt(flags["reuse-circle"]) : null;
const VERBOSE = flags.verbose!;

function verbose(...args: unknown[]) {
  if (VERBOSE) console.log("   [verbose]", ...args);
}

// ---

const RPC_URL = config.stellarRpcUrl;
const NETWORK_PASSPHRASE = config.stellarNetworkPassphrase;
const TOKEN = config.testTokenContractId;
const CONTRACT_ID = config.shariboContractId;
const ADMIN_SECRET = config.adminSecretKey;

const CIRCLE_SIZE = 5;
const CONTRIBUTION = 100_000_000n; // 10 XLM (7 decimals)
const CLAIMANT_INDEX = 2;

// --- Timing utility ---
// Wraps an async step and prints wall-clock duration.
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const elapsed = ((performance.now() - start) / 1000).toFixed(1);
  console.log(`   [${elapsed}s] ${label}`);
  return result;
}

// Node's own fetch()/undici hung indefinitely against these two endpoints in
// this environment even with AbortSignal.timeout set, while plain `curl`
// consistently worked in seconds (see NOTES.md) — so these two HTTP calls
// specifically shell out to curl rather than use fetch.
async function curlGet(url: string): Promise<string> {
  verbose("curl GET", url);
  const { stdout } = await execFileAsync("curl", ["-s", "--max-time", "15", url]);
  verbose("curl response length:", stdout.length, "bytes");
  return stdout;
}

async function friendbotFund(publicKey: string): Promise<void> {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      verbose(`friendbot attempt ${attempt}/${attempts} for ${publicKey}`);
      await curlGet(`https://friendbot.stellar.org?addr=${publicKey}`);
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      const delay = 2000 * attempt;
      verbose(`friendbot failed, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function nativeBalance(publicKey: string): Promise<bigint> {
  verbose("fetching balance for", publicKey);
  const body = await curlGet(`https://horizon-testnet.stellar.org/accounts/${publicKey}`);
  const account = JSON.parse(body);
  const native = account.balances.find((b: { asset_type: string }) => b.asset_type === "native");
  // Horizon reports balances as decimal XLM strings; convert to stroops.
  const stroops = BigInt(Math.round(parseFloat(native.balance) * 1e7));
  verbose("balance:", stroops.toString(), "stroops");
  return stroops;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

interface StepResult {
  name: string;
  durationMs: number;
  status: "ok" | "failed";
}

const stepResults: StepResult[] = [];

// Wraps a phase of the run so its duration and outcome land in the summary
// table printed at the end, whether the run as a whole succeeds or fails.
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    stepResults.push({ name, durationMs: Date.now() - start, status: "ok" });
    return result;
  } catch (err) {
    stepResults.push({ name, durationMs: Date.now() - start, status: "failed" });
    throw err;
  }
}

function printStepSummary(): void {
  if (stepResults.length === 0) return;
  const nameWidth = Math.max("phase".length, ...stepResults.map((s) => s.name.length));
  const totalMs = stepResults.reduce((sum, s) => sum + s.durationMs, 0);
  console.log("\nStep timing summary:");
  console.log(`  ${"phase".padEnd(nameWidth)}  duration    status`);
  for (const s of stepResults) {
    console.log(
      `  ${s.name.padEnd(nameWidth)}  ${`${s.durationMs}ms`.padEnd(10)}  ${s.status}`,
    );
  }
  console.log(`  ${"total".padEnd(nameWidth)}  ${`${totalMs}ms`.padEnd(10)}`);
}

// Testnet RPC calls occasionally stall rather than erroring outright; a
// bounded timeout turns that into a clear failure instead of a silent hang.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  verbose("withTimeout:", label, `(${ms}ms)`);
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)), ms),
    ),
  ]);
}

// Everything a run touched, dumped to scratch/ (gitignored) so a failed or
// interesting run can be re-inspected afterward: get_circle'd, replayed, or
// have its proof re-derived, without re-running the whole script.
interface RunArtifactMember {
  publicKey: string;
  identityNullifier: string;
  identitySecret: string;
  commitment: string;
  fundTxHashRound0?: string;
  fundTxHashRound1?: string;
}

interface RunArtifact {
  _WARNING: string;
  timestamp: string;
  network: { rpcUrl: string; networkPassphrase: string; contractId: string; token: string };
  circleId?: string;
  treeRoot?: string;
  createCircleTxHash?: string;
  members: RunArtifactMember[];
  claim?: { recipient: string; txHash: string; nullifierHash: string };
  replayAttempt?: { rejected: boolean; detail: string };
}

const runArtifact: RunArtifact = {
  _WARNING:
    "TESTNET-ONLY DEBUG ARTIFACT — contains identity secrets (identityNullifier/identitySecret). " +
    "Never commit this file, never let it leave scratch/, never reuse these keys for anything real.",
  timestamp: new Date().toISOString(),
  network: {
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    contractId: CONTRACT_ID,
    token: TOKEN,
  },
  members: [],
};

function writeRunArtifact(): string {
  const scratchDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scratch");
  mkdirSync(scratchDir, { recursive: true });
  const filePath = path.join(
    scratchDir,
    `e2e-run-${runArtifact.timestamp.replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(
    filePath,
    JSON.stringify(runArtifact, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2),
  );
  return filePath;
}

async function main() {
  console.log("Sharibo e2e — full private round on Stellar testnet");
  if (SKIP_REPLAY) console.log("  (--skip-replay: stopping after claim)");
  if (REUSE_CIRCLE != null) console.log(`  (--reuse-circle: using circle ${REUSE_CIRCLE})`);
  if (VERBOSE) console.log("  (--verbose: echoing all interactions)");
  console.log();

  const health = await checkContractDeployed(RPC_URL, CONTRACT_ID);
  if (!health.ok) {
    console.error(`\n${health.message}\n`);
    process.exit(1);
  }

  const admin = Keypair.fromSecret(ADMIN_SECRET);

  console.log("1. Generating 5 member identities + funding accounts via friendbot...");
  const members = Array.from({ length: CIRCLE_SIZE }, () => ({
    keypair: Keypair.random(),
    identity: generateIdentity(),
  }));

  // Friendbot funding: parallelized via Promise.all. Each account is
  // independent — no shared state, no sequence contention. This is the
  // single biggest wall-time win (5 sequential HTTP round-trips → 1).
  await timed("friendbot funding (parallel)", async () => {
    await Promise.all(members.map((m) => friendbotFund(m.keypair.publicKey())));
  });
  console.log(
    "   members:",
    members.map((m) => m.keypair.publicKey()),
  );
  runArtifact.members = members.map((m) => ({
    publicKey: m.keypair.publicKey(),
    identityNullifier: m.identity.identityNullifier.toString(),
    identitySecret: m.identity.identitySecret.toString(),
    commitment: m.identity.commitment.toString(),
  }));

  const { tree, vk } = await step("build merkle tree + load verification key", async () => {
    const tree = MerkleTree.create(
      LEVELS,
      members.map((m) => m.identity.commitment),
    );
    console.log("   Merkle root:", tree.root.toString());

    const vkJson = JSON.parse(
      readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "circuits", "verification_key.json"),
        "utf8",
      ),
    );
    return { tree, vk: verificationKeyToContractFormat(vkJson) };
  });

  verbose("connecting admin client...");
  const adminClient = await withTimeout(
    connect(
      { contractId: CONTRACT_ID, rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE },
      admin,
    ),
    30_000,
    "connect(admin)",
  );

  let circleId: bigint;
  if (REUSE_CIRCLE != null) {
    circleId = REUSE_CIRCLE;
    console.log(`\n2. Reusing existing circle ${circleId} (--reuse-circle)...`);
    const existing = await getCircle(adminClient, circleId);
    console.log(`   circle ${circleId}: round=${existing.round}, pot=${existing.pot}, size=${existing.size}`);
  } else {
    console.log("\n2. Creating the circle...");
    const { result } = await withTimeout(
      createCircle(adminClient, {
        admin: admin.publicKey(),
        token: TOKEN,
        root: tree.root,
        contribution: CONTRIBUTION,
        size: CIRCLE_SIZE,
        vk,
      }),
      30_000,
      "createCircle",
    );
    circleId = result;
    console.log("   circle_id =", circleId);
  }

  console.log("\n3. Funding from all 5 members...");
  for (const [i, m] of members.entries()) {
    verbose(`connecting member ${i}...`);
    const memberClient = await withTimeout(
      connect(
        { contractId: CONTRACT_ID, rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE },
        m.keypair,
      ),
      30_000,
      "createCircle",
    );
    verbose(`funding from member ${i}...`);
    await withTimeout(
      fund(memberClient, { circleId, from: m.keypair.publicKey() }),
      30_000,
      `fund(member ${i})`,
    );
    console.log("   pot fully funded:", fundedCircle.pot.toString(), "stroops");
  });

  console.log("\n4. Generating a real ZK proof for member", CLAIMANT_INDEX, "...");
  const externalNullifier = await computeExternalNullifier(circleId, 0n);
  const circuitsBuildDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "circuits",
    "build",
  );
  verbose("generating proof with wasm + zkey from", circuitsBuildDir);
  const { proof, nullifierHash, root, externalNullifier: provenExternalNullifier } =
    await timed("proof generation", () =>
      generateProof(
        {
          identityNullifier: claimant.identity.identityNullifier,
          identitySecret: claimant.identity.identitySecret,
          pathElements: merkleProof.pathElements,
          pathIndices: merkleProof.pathIndices,
          root: tree.root,
          externalNullifier,
        },
        path.join(circuitsBuildDir, "membership_js", "membership.wasm"),
        path.join(circuitsBuildDir, "membership_final.zkey"),
      ),
    );
    const { proof, nullifierHash, root, externalNullifier: provenExternalNullifier } =
      await generateProof(
        {
          identityNullifier: claimant.identity.identityNullifier,
          identitySecret: claimant.identity.identitySecret,
          pathElements: merkleProof.pathElements,
          pathIndices: merkleProof.pathIndices,
          root: tree.root,
          externalNullifier,
        },
        path.join(circuitsBuildDir, "membership_js", "membership.wasm"),
        path.join(circuitsBuildDir, "membership_final.zkey"),
      );
    assert(root === tree.root, "proof's public root must match the circle's root");
    assert(
      provenExternalNullifier === externalNullifier,
      "proof's public externalNullifier must match the expected round tag",
    );
    console.log("   proof generated, nullifierHash =", nullifierHash.toString());
    return { proof, nullifierHash };
  });

  console.log("\n5. Generating a FRESH recipient address (never used as a funder)...");
  const recipient = await step("fund fresh recipient", async () => {
    const recipient = Keypair.random();
    await friendbotFund(recipient.publicKey());
    console.log("   recipient =", recipient.publicKey());
    return recipient;
  });

  console.log("\n6. Claiming the pot to the fresh recipient...");
  const balanceBefore = await nativeBalance(recipient.publicKey());
  verbose("submitting claim transaction...");
  const { hash: claimTxHash, feeCharged } = await withTimeout(
    claim(adminClient, {
      circleId,
      recipient: recipient.publicKey(),
      nullifierHash,
      externalNullifier,
      proof,
    }),
    30_000,
    "claim (round 0)",
  );
  runArtifact.claim = {
    recipient: recipient.publicKey(),
    txHash: claimTxHash,
    nullifierHash: nullifierHash.toString(),
  };
  const balanceAfter = await nativeBalance(recipient.publicKey());
  assert(
    balanceAfter - balanceBefore === CONTRIBUTION * BigInt(CIRCLE_SIZE),
    `recipient should have received exactly the pot (got delta ${balanceAfter - balanceBefore})`,
  );

  const claimedCircle = await getCircle(adminClient, circleId);
  assert(claimedCircle.pot === 0n, "pot should be empty after claim");
  assert(claimedCircle.round === 1, "round should have advanced to 1");
  console.log("   payout confirmed: pot -> 0, round -> 1");
  
  // Log fee estimate vs actual charged delta if available
  if (feeCharged) {
    const feeChargedNum = typeof feeCharged === "string" ? BigInt(feeCharged) : feeCharged;
    console.log("   claim fee charged:", feeChargedNum.toString(), "stroops");
  }

  if (SKIP_REPLAY) {
    console.log("\n--skip-replay: skipping round 2 funding + replay check.");
    console.log("\nAll assertions passed (claim only).");
  } else {
    console.log("\n7. Funding round 1, then attempting to reuse round 0's nullifier...");
    // Fund a fresh round first so this specifically exercises nullifier-reuse
    // rejection (AlreadyClaimed) rather than the (also-true, but less
    // interesting) fact that an empty pot can't be claimed.
    for (const [i, m] of members.entries()) {
      verbose(`connecting member ${i} for round 1...`);
      const memberClient = await withTimeout(
        connect({ contractId: CONTRACT_ID, rpcUrl: RPC_URL, networkPassphrase: NETWORK_PASSPHRASE }, m.keypair),
        30_000,
        `connect(member ${i}, round 1)`,
      );
      verbose(`funding member ${i} for round 1...`);
      await withTimeout(
        fund(memberClient, { circleId, from: m.keypair.publicKey() }),
        30_000,
        `fund(member ${i}, round 1)`,
      );
      console.log(`   [${i + 1}/${CIRCLE_SIZE}] funded round 1 from`, m.keypair.publicKey());
    }
    const round1ExternalNullifier = await computeExternalNullifier(circleId, 1n);

    let secondClaimRejected = false;
    try {
      verbose("attempting replay with round 0's nullifier against round 1...");
      await withTimeout(
        claim(adminClient, {
          circleId,
          recipient: Keypair.random().publicKey(),
          nullifierHash,
          externalNullifier: round1ExternalNullifier,
          proof,
        }),
        30_000,
        "claim (reuse attempt)",
      );
    } catch (err) {
      const message = (err as Error).message;
      secondClaimRejected = true;
      assert(
        message.includes("Error(Contract, #4)"),
        `expected AlreadyClaimed (#4), got: ${message.split("\n")[0]}`,
      );
      console.log("   rejected as expected (AlreadyClaimed):", message.split("\n")[0]);
    }
    assert(secondClaimRejected, "a second claim with the same nullifier must be rejected");

    console.log("\nAll assertions passed.");
  }

  console.log(
    `Recipient ${recipient.publicKey()} is a freshly generated keypair with no on-chain history`,
    "connecting it to any of the 5 funders — that's the unlinkability the ZK proof buys.",
  );

  printStepSummary();

  // The RPC client's underlying HTTP keep-alive connections otherwise leave
  // the process hanging after main() resolves.
  process.exit(0);
}

main().catch((err) => {
  console.error("\ne2e FAILED:", err);
  printStepSummary();
  process.exit(1);
});
