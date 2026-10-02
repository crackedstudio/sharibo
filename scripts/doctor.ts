import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TMP_DIR = path.join(__dirname, ".doctor-tmp");

// ── CLI flags ─────────────────────────────────────────────────────────────────

const { values: flags } = parseArgs({
  options: { fix: { type: "boolean", default: false } },
  strict: false, // ignore unknown flags (e.g. npm workspace pass-through)
});
const FIX_MODE = flags.fix ?? false;

// ── Types ─────────────────────────────────────────────────────────────────────

type Check = {
  name: string;
  /** blocking = failure exits non-zero; optional = warning only */
  blocking: boolean;
  ok: boolean;
  found: string;
  required: string;
  fix: string;
  /** Shell command that --fix will run to auto-resolve, if mechanical */
  autofix?: { command: string; args: string[] };
  /** docs/troubleshooting.md anchor for this failure */
  docsAnchor?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function semverCompare(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

async function run(
  cmd: string,
  args: string[],
  encoding: BufferEncoding = "utf8",
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { encoding });
    return stdout.trim();
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; code?: number | null };
    const detail = err.stderr?.trim() || err.stdout?.trim();
    return `__ERROR__:${err.code ?? "nonzero"}${detail ? `: ${detail}` : ""}`;
  }
}

async function runFix(fix: NonNullable<Check["autofix"]>): Promise<boolean> {
  const command = [fix.command, ...fix.args].join(" ");
  console.log(`   ▶ running: ${command}`);
  try {
    const { stdout, stderr } = await execFileAsync(command, [], {
      encoding: "utf8",
      shell: true,
    });
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    console.log("   ✔ done");
    return true;
  } catch (e: unknown) {
    const err = e as { stderr?: string; message?: string };
    console.error(`   ✖ fix command failed: ${err.stderr ?? err.message}`);
    return false;
  }
}

// ── Individual checks ─────────────────────────────────────────────────────────

async function checkRust(): Promise<Check> {
  const rustc = await run("rustc", ["--version"]);
  const targetList = await run("rustup", ["target", "list", "--installed"]);
  const hasTarget = targetList.includes("wasm32v1-none");

  let toolchainChannel = "1.94.1";
  try {
    const toolchainContent = readFileSync(path.join(REPO_ROOT, "rust-toolchain.toml"), "utf8");
    const match = toolchainContent.match(/channel\s*=\s*"([^"]+)"/);
    if (match && match[1]) {
      toolchainChannel = match[1];
    }
  } catch (e) {
    // fallback if file doesn't exist
  }

  const required = `rustc == ${toolchainChannel} (pinned in rust-toolchain.toml) + wasm32v1-none target`;

  if (rustc.startsWith("rustc ")) {
    const version = rustc.split(" ")[1];
    const versionOk = version === toolchainChannel;
    const ok = versionOk && hasTarget;

    let fixStr = `rustup install ${toolchainChannel} && rustup target add wasm32v1-none`;
    if (hasTarget && versionOk) {
      fixStr = "";
    } else if (hasTarget) {
      fixStr = `rustup default ${toolchainChannel} (or ensure rust-toolchain.toml is picked up)`;
    } else if (versionOk) {
      fixStr = `rustup target add wasm32v1-none`;
    }

    const autofix: Check["autofix"] = hasTarget
      ? undefined
      : { command: "rustup", args: ["target", "add", "wasm32v1-none"] };

    return {
      name: "Rust + wasm32v1-none",
      blocking: true,
      ok,
      found: `${rustc} | wasm32v1-none: ${hasTarget}`,
      required,
      fix: fixStr,
      autofix,
      docsAnchor: "missing-wasm32v1-none-rust-target",
    };
  }
  return {
    name: "Rust + wasm32v1-none",
    blocking: true,
    ok: false,
    found: "missing",
    required,
    fix: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh && rustup install ${toolchainChannel} && rustup target add wasm32v1-none`,
    docsAnchor: "missing-wasm32v1-none-rust-target",
  };
}

async function checkCurl(): Promise<Check> {
  const out = await run("curl", ["--version"]);
  return {
    name: "curl",
    blocking: true,
    ok: !out.startsWith("__ERROR__"),
    found: out.startsWith("curl ") ? out.split("\n")[0] : "missing",
    required: "curl (used by scripts/e2e.ts for friendbot + Horizon calls)",
    fix: "Install via your OS package manager: brew install curl / apt install curl",
    docsAnchor: "missing-curl-for-end-to-end-tests",
  };
}

async function checkStellar(): Promise<Check> {
  const out = await run("stellar", ["--version"]);
  const required = "stellar >= v21.0";
  if (out.startsWith("stellar ")) {
    const version = out.split(" ")[1];
    const ok = semverCompare(version, "21.0.0") >= 0;
    return {
      name: "stellar CLI",
      blocking: true,
      ok,
      found: out,
      required,
      fix: "See https://developers.stellar.org/docs/tools/cli/install-cli",
      docsAnchor: "soroban-vs-stellar-cli-confusion",
    };
  }
  return {
    name: "stellar CLI",
    blocking: true,
    ok: false,
    found: "missing",
    required,
    fix: "See https://developers.stellar.org/docs/tools/cli/install-cli",
    docsAnchor: "soroban-vs-stellar-cli-confusion",
  };
}

async function checkNode(): Promise<Check> {
  const out = await run("node", ["--version"]);
  const required = "Node >= 20.6.0";
  if (out.startsWith("v")) {
    const ok = semverCompare(out, "20.6.0") >= 0;
    return {
      name: "Node.js",
      blocking: true,
      ok,
      found: out,
      required,
      fix: "nvm install 20 || fnm install 20 || https://nodejs.org/en/download/",
    };
  }
  return {
    name: "Node.js",
    blocking: true,
    ok: false,
    found: "missing",
    required,
    fix: "nvm install 20 || fnm install 20 || https://nodejs.org/en/download/",
  };
}

async function checkNodeVersion(): Promise<Check> {
  const nvmrcPath = path.join(REPO_ROOT, ".nvmrc");
  const enginesRaw = (() => {
    try {
      const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
      return (pkg.engines?.node as string | undefined) ?? null;
    } catch {
      return null;
    }
  })();
  const nvmrc = existsSync(nvmrcPath) ? readFileSync(nvmrcPath, "utf8").trim() : null;
  const currentRaw = await run("node", ["--version"]);
  const current = currentRaw.replace(/^v/, "");
  const pinned = nvmrc ?? enginesRaw;
  const pinnedMajor = pinned ? Number.parseInt(pinned.replace(/[^0-9].*$/, ""), 10) : undefined;
  const currentMajor = Number.parseInt(current.split(".")[0], 10);
  const ok = pinnedMajor === undefined || currentMajor === pinnedMajor;

  return {
    name: "Node.js version vs .nvmrc",
    blocking: false,
    ok,
    found: `v${current}`,
    required: pinned
      ? `Node ${pinned} from ${nvmrc ? ".nvmrc" : "package.json engines"}`
      : "No Node version pin found in .nvmrc or package.json engines",
    fix: pinnedMajor
      ? `nvm use ${pinnedMajor} (or: nvm install ${pinnedMajor})`
      : "Add a Node version pin to .nvmrc or package.json engines",
    docsAnchor: "node-version-does-not-match-the-repository-pin",
  };
}

async function checkCircom(): Promise<Check> {
  const out = await run("circom", ["--version"]);
  const required = "circom >= 2.1.6 (built from source for bls12381)";
  let primeOk = false;
  if (out.startsWith("circom ")) {
    const version = out.split(" ")[1];
    const versionOk = semverCompare(version, "2.1.6") >= 0;
    mkdirSync(TMP_DIR, { recursive: true });
    const tmpCircom = path.join(TMP_DIR, "doctor.circom");
    const tmpJson = path.join(TMP_DIR, "doctor.json");
    writeFileSync(
      tmpCircom,
      "pragma circom 2.1.6;\n" +
        "template Doctor() {}\n" +
        "component main {public []=} = Doctor();\n",
    );
    const primeOut = await run("circom", [
      "--prime",
      "bls12381",
      tmpCircom,
      "-o",
      TMP_DIR,
      "--json",
      tmpJson,
    ]);
    primeOk = !primeOut.includes("Unknown prime") && !primeOut.includes("__ERROR__");
    try {
      unlinkSync(tmpCircom);
    } catch {}
    try {
      unlinkSync(tmpJson);
    } catch {}
    try {
      unlinkSync(path.join(TMP_DIR, "doctor.r1cs"));
    } catch {}
    return {
      name: "circom",
      blocking: true,
      ok: versionOk && primeOk,
      found: `${out} | bls12381 support: ${primeOk}`,
      required,
      fix: "git clone https://github.com/iden3/circom.git && cd circom && cargo build --release && cargo install --path circom",
      docsAnchor: "circom-command-not-found-or-an-ancient-1x-circom",
    };
  }
  return {
    name: "circom",
    blocking: true,
    ok: false,
    found: "missing",
    required,
    fix: "git clone https://github.com/iden3/circom.git && cd circom && cargo build --release && cargo install --path circom",
    docsAnchor: "circom-command-not-found-or-an-ancient-1x-circom",
  };
}

async function checkCircomDeps(): Promise<Check> {
  const packageNames = ["snarkjs", "mocha", "circom_tester"];
  const found = Object.fromEntries(
    packageNames.map((name) => [
      name,
      [
        path.join(REPO_ROOT, "node_modules", name),
        path.join(REPO_ROOT, "circuits", "node_modules", name),
      ].some(existsSync),
    ]),
  );
  const ok = Object.values(found).every(Boolean);
  return {
    name: "circuit JavaScript dependencies",
    blocking: true,
    ok,
    found: packageNames
      .map((name) => `${name}: ${found[name] ? "installed" : "missing"}`)
      .join(" | "),
    required: "snarkjs, mocha, and circom_tester installed (needed by circuit setup and tests)",
    fix: "npm install",
    docsAnchor: "circuit-tests-fail-because-javascript-dependencies-are-missing",
  };
}

async function checkClientDist(): Promise<Check> {
  const distIndex = path.join(REPO_ROOT, "packages", "client", "dist", "index.js");
  const ok = existsSync(distIndex);
  return {
    name: "packages/client dist built",
    blocking: true,
    ok,
    found: ok ? distIndex : "packages/client/dist/ not found",
    required:
      "packages/client must be compiled before app tests or scripts can import @sharibo/client",
    fix: "npm run build --workspace=packages/client",
    autofix: {
      command: "npm",
      args: ["run", "build", "--workspace=packages/client"],
    },
    docsAnchor: "client-sdk-dist-is-not-built",
  };
}

async function checkCircuitArtifacts(): Promise<Check> {
  const verifier = path.join(REPO_ROOT, "circuits", "scripts", "verify-artifacts.mjs");
  const result = await run(process.execPath, [verifier]);
  const ok = result === "Circuit artifacts verified.";

  return {
    name: "circuit build artifacts and SHA-256 manifests",
    blocking: true,
    ok,
    found: ok ? result : result.replace(/^__ERROR__:[^:]+:?\s*/, "").replace(/\n/g, " "),
    required:
      "Compiled membership wasm, final zkey, verification key, and matching SHA-256 manifests",
    fix: "cd circuits && npm run compile && ALLOW_KEY_ROTATION=1 npm run setup",
    docsAnchor: "browser-app-build-fails-because-circuit-artifacts-or-hashes-are-missing",
  };
}

async function checkEnv(): Promise<Check> {
  const envPath = path.join(REPO_ROOT, ".env");
  if (!existsSync(envPath)) {
    return {
      name: ".env file",
      blocking: true,
      ok: false,
      found: ".env not found",
      required: ".env must exist and contain valid script configuration",
      fix: "cp .env.example .env, then fill the required values (see README §1)",
      docsAnchor: "scripts-fail-because-env-is-missing-or-invalid",
    };
  }

  const envValues: Record<string, string> = {};
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    envValues[key] = process.env[key] ?? value;
  }

  const requiredKeys = ["TEST_TOKEN_CONTRACT_ID", "SHARIBO_CONTRACT_ID", "ADMIN_SECRET_KEY"];
  const invalidKeys = requiredKeys.filter((key) => {
    const value = envValues[key]?.trim() ?? "";
    const prefix = key === "ADMIN_SECRET_KEY" ? "S" : "C";
    return value.length !== 56 || !value.startsWith(prefix);
  });
  const rpcUrl = envValues.STELLAR_RPC_URL?.trim();
  if (rpcUrl) {
    try {
      const url = new URL(rpcUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:")
        invalidKeys.push("STELLAR_RPC_URL");
    } catch {
      invalidKeys.push("STELLAR_RPC_URL");
    }
  }
  const ok = invalidKeys.length === 0;

  return {
    name: ".env present and valid",
    blocking: true,
    ok,
    found: ok
      ? ".env present; required contract IDs and secret key have valid formats"
      : `invalid or missing values: ${[...new Set(invalidKeys)].join(", ")}`,
    required:
      "Valid TEST_TOKEN_CONTRACT_ID, SHARIBO_CONTRACT_ID, ADMIN_SECRET_KEY; optional STELLAR_RPC_URL must be HTTP(S)",
    fix: "Fill the listed values in .env (see .env.example and README §1 for generating Stellar keys)",
    docsAnchor: "scripts-fail-because-env-is-missing-or-invalid",
  };
}

async function checkCargoCov(): Promise<Check> {
  const out = await run("cargo", ["llvm-cov", "--version"]);
  const ok = !out.startsWith("__ERROR__");
  return {
    name: "cargo-llvm-cov",
    blocking: false,
    ok,
    found: ok ? out : "missing",
    required: "optional — needed only for `just coverage` (contracts coverage report)",
    fix: "cargo install cargo-llvm-cov",
    docsAnchor: "cargo-llvm-cov-is-optional",
  };
}

async function checkJust(): Promise<Check> {
  const out = await run("just", ["--version"]);
  if (out.startsWith("just ")) {
    return {
      name: "just",
      blocking: false,
      ok: true,
      found: out,
      required: "optional — shorthand recipes (just doctor, just circuits, …)",
      fix: "cargo install just",
    };
  }
  return {
    name: "just",
    blocking: false,
    ok: false,
    found: "missing (optional)",
    required: "optional — shorthand recipes (just doctor, just circuits, …)",
    fix: "cargo install just",
    docsAnchor: "just-is-optional",
  };
}

// ── Output ────────────────────────────────────────────────────────────────────

const DOCS_BASE = "docs/troubleshooting.md";

function printCheck(c: Check): void {
  const tag = c.blocking ? "" : " (optional)";
  const icon = c.ok ? "✅" : c.blocking ? "❌" : "⚠️ ";
  console.log(`${icon} ${c.name}${tag}`);
  console.log(`   found:    ${c.found}`);
  console.log(`   required: ${c.required}`);
  if (!c.ok) {
    console.log(`   fix:      ${c.fix}`);
    if (c.docsAnchor) {
      console.log(`   docs:     ${DOCS_BASE}#${c.docsAnchor}`);
    }
  }
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n🩺 Sharibo toolchain doctor\n");

  const checkAll = async (): Promise<Check[]> =>
    Promise.all([
      checkRust(),
      checkCurl(),
      checkStellar(),
      checkNode(),
      checkNodeVersion(),
      checkCircom(),
      checkCircomDeps(),
      checkClientDist(),
      checkCircuitArtifacts(),
      checkEnv(),
      checkCargoCov(),
      checkJust(),
    ]);
  let checks = await checkAll();

  if (FIX_MODE) {
    const fixable = checks.filter((c) => c.blocking && !c.ok && c.autofix);
    for (const check of fixable) {
      await runFix(check.autofix!);
    }
    if (fixable.length > 0) checks = await checkAll();
  }

  for (const c of checks) printCheck(c);

  const blocking = checks.filter((c) => c.blocking && !c.ok);
  const warnings = checks.filter((c) => !c.blocking && !c.ok);

  if (warnings.length > 0) {
    console.log(
      `⚠️  ${warnings.length} optional tool(s) missing — see above. These only affect coverage and recipe shortcuts.`,
    );
  }

  if (blocking.length > 0) {
    console.log(
      `\n❌ ${blocking.length} blocking issue(s) found.\n` +
        `   Run \`just doctor --fix\` to auto-resolve mechanical issues,\n` +
        `   then follow the fix: lines above for the rest.\n`,
    );
    process.exit(1);
  }

  console.log("✅ All blocking checks passed. Run `just circuits` to compile circuits.\n");
}

main().catch((e) => {
  console.error("doctor failed:", e);
  process.exit(1);
});
