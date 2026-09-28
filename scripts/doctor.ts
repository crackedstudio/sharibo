import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_DIR = path.join(__dirname, ".doctor-tmp");

type Check = {
  name: string;
  ok: boolean;
  found: string;
  required: string;
  install: string;
  fix?: string;
  /**
   * Whether a failure blocks `just ci`. Non-blocking checks (marked
   * OPTIONAL) still print, but never fail the run — they matter for the
   * heavier flows (circuits, e2e, coverage) rather than the merge gate.
   */
  blocking?: boolean;
  /** Runnable shell command the doctor can execute itself under `--fix`. */
  fixCmd?: string;
};

const REPO_ROOT = path.join(__dirname, "..");

function readTextFile(relPath: string): string | null {
  try {
    return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
  } catch {
    return null;
  }
}

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

async function run(cmd: string, args: string[], encoding: BufferEncoding = "utf8"): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { encoding: encoding });
    return stdout.trim();
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; code?: number | null };
    return `__ERROR__:${err.code ?? "nonzero"}`;
  }
}

async function checkRust(): Promise<Check> {
  const rustc = await run("rustc", ["--version"]);
  const target = await run("rustup", ["target", "list", "--installed"]);
  const hasTarget = target.includes("wasm32v1-none");
  const required = "rustc >= 1.56.0 + wasm32v1-none target";
  if (rustc.startsWith("rustc ")) {
    const version = rustc.split(" ")[1];
    const ok = hasTarget && semverCompare(version, "1.56.0") >= 0;
    return {
      name: "Rust + wasm32v1-none",
      ok,
      found: `${rustc} | target installed: ${hasTarget}`,
      required,
      install: "rustup install stable && rustup target add wasm32v1-none",
      fix: hasTarget ? undefined : "Run: rustup target add wasm32v1-none",
      fixCmd: hasTarget ? undefined : "rustup target add wasm32v1-none",
    };
  }
  return {
    name: "Rust + wasm32v1-none",
    ok: false,
    found: "missing",
    required,
    install: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh && rustup target add wasm32v1-none",
  };
}

async function checkStellar(): Promise<Check> {
  const out = await run("stellar", ["--version"]);
  const required = "stellar >= v21.0 (only for deploys / `stellar contract build`)";
  if (out.startsWith("stellar ")) {
    const version = out.split(" ")[1];
    const ok = semverCompare(version, "21.0.0") >= 0;
    return {
      name: "stellar CLI [OPTIONAL for just ci]",
      ok,
      found: out,
      required,
      install: "See https://developers.stellar.org/docs/tools/cli/install-cli",
      fix: ok ? undefined : "Install stellar CLI v21.0+",
      blocking: false,
    };
  }
  return {
    name: "stellar CLI [OPTIONAL for just ci]",
    ok: false,
    found: "missing",
    required,
    install: "See https://developers.stellar.org/docs/tools/cli/install-cli",
    blocking: false,
  };
}

async function checkNode(): Promise<Check> {
  const out = await run("node", ["--version"]);
  const required = "Node >= 20.6.0";
  if (out.startsWith("v")) {
    const ok = semverCompare(out, "20.6.0") >= 0;
    return {
      name: "Node.js",
      ok,
      found: out,
      required,
      install: "nvm install 20 || fnm install 20 || https://nodejs.org/en/download/",
      fix: ok ? undefined : "Upgrade Node.js to >= 20.6.0",
      blocking: true,
    };
  }
  return {
    name: "Node.js",
    ok: false,
    found: "missing",
    required,
    install: "nvm install 20 || fnm install 20 || https://nodejs.org/en/download/",
    blocking: true,
  };
}

/**
 * Advisory only: does the running Node match the repo .nvmrc major line?
 * Newer majors that satisfy the minimum are fine (README's tested runtime
 * is newer than the pin) — this never blocks, it just tells `nvm use`
 * users when they've drifted.
 */
async function checkNodePin(): Promise<Check> {
  const out = await run("node", ["--version"]);
  const nvmrc = readTextFile(".nvmrc")?.trim();
  if (!nvmrc) {
    return {
      name: "Node.js .nvmrc pin [ADVISORY]",
      ok: true,
      found: "no .nvmrc pin",
      required: "informational only",
      install: "n/a",
      blocking: false,
    };
  }
  const runningMajor = out.replace(/^v/, "").split(".")[0];
  const pinMajor = nvmrc.replace(/^v/, "").split(".")[0];
  const ok = !out.startsWith("v") || runningMajor === pinMajor;
  return {
    name: "Node.js .nvmrc pin [ADVISORY]",
    ok,
    found: out.startsWith("v") ? `${out} vs .nvmrc ${nvmrc}` : "node missing (see Node.js check)",
    required: `nvm use (${nvmrc} line) for byte-identical runs; newer majors are fine`,
    install: "nvm use",
    blocking: false,
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
        "component main {public []=} = Doctor();\n"
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
    try { unlinkSync(tmpCircom); } catch {}
    try { unlinkSync(tmpJson); } catch {}
    try { unlinkSync(path.join(TMP_DIR, "doctor.r1cs")); } catch {}
    return {
      name: "circom [OPTIONAL for just ci]",
      ok: versionOk && primeOk,
      found: `${out} | bls12381 support: ${primeOk}`,
      required: `${required} (only for circuits/ work)`,
      install: "git clone https://github.com/iden3/circom.git && cd circom && cargo build --release && cargo install --path circom",
      fix: primeOk ? undefined : "Build circom from source with --features bls12381 (see docs/troubleshooting.md)",
      blocking: false,
    };
  }
  return {
    name: "circom [OPTIONAL for just ci]",
    ok: false,
    found: "missing",
    required: `${required} (only for circuits/ work)`,
    install: "git clone https://github.com/iden3/circom.git && cd circom && cargo build --release && cargo install --path circom",
    blocking: false,
  };
}

async function checkJust(): Promise<Check> {
  const out = await run("just", ["--version"]);
  const required = "just (optional, for recipes)";
  if (out.startsWith("just ")) {
    return {
      name: "just",
      ok: true,
      found: out,
      required,
      install: "cargo install just",
    };
  }
  return {
    name: "just",
    ok: true,
    found: "missing (optional)",
    required,
    install: "cargo install just",
  };
}

/**
 * The built SDK (`packages/client/dist/`) is the single most common fresh-
 * clone trap: app/scripts tests and typechecks fail without it, and nothing
 * says so (see #458). Rebuilding is mechanical, so this check carries a fix.
 */
async function checkSdkBuilt(): Promise<Check> {
  const pkg = readTextFile("packages/client/package.json");
  const hasIndex = readTextFile("packages/client/dist/index.js") !== null;
  const hasInternal = readTextFile("packages/client/dist/internal.js") !== null;
  const ok = pkg !== null && hasIndex && hasInternal;
  return {
    name: "Built SDK (packages/client/dist/)",
    ok,
    found: !pkg
      ? "packages/client/package.json missing — are you at the repo root?"
      : hasIndex && hasInternal
        ? "dist/index.js + dist/internal.js present"
        : "dist/ missing or stale (run the fix below)",
    required: "fresh `dist/` built from packages/client/src",
    install: "npm run build --workspace=packages/client",
    fix: ok ? undefined : "Build the SDK so app/scripts resolve @sharibo/client",
    fixCmd: ok ? undefined : "npm run build --workspace=packages/client",
    blocking: true,
  };
}

/**
 * Circuit artifacts (`circuits/build/`) are gitignored and needed by
 * `npm run build --workspace=app`, e2e, and the circuit tests — but NOT by
 * `just ci`. Warning, not failure. See docs/troubleshooting.md
 * §"Browser app shows a blank / broken proving step".
 */
async function checkCircuitArtifacts(): Promise<Check> {
  const hasWasm = readTextFile("circuits/build/membership.wasm") !== null;
  const hasZkey = readTextFile("circuits/build/membership_final.zkey") !== null;
  const hasVk = readTextFile("circuits/verification_key.json") !== null;
  // verification_key.json is committed; the build outputs are not.
  const ok = hasWasm && hasZkey;
  return {
    name: "Circuit artifacts (circuits/build/) [OPTIONAL for just ci]",
    ok,
    found: `membership.wasm: ${hasWasm}, membership_final.zkey: ${hasZkey}, verification_key.json (committed): ${hasVk}`,
    required: "compiled circuit + trusted setup (only for app build, e2e, circuit tests)",
    install: "cd circuits && npm run compile && npm run setup",
    fix: ok ? undefined : "Compile + setup take a while — only needed for circuits/app/e2e work",
    blocking: false,
  };
}

/**
 * `.env` presence. The scripts workspace validates eagerly on import, so a
 * missing file fails every scripts run with an aggregated error — tell the
 * newcomer up front. Not blocking for `just ci` (its tests stub their env).
 * See docs/troubleshooting.md and README §1.
 */
async function checkEnvFile(): Promise<Check> {
  const env = readTextFile(".env");
  const example = readTextFile(".env.example");
  if (env !== null) {
    const emptyKeys = env
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^[A-Z][A-Z0-9_]*=\s*$/.test(l)).length;
    return {
      name: ".env file [OPTIONAL for just ci]",
      ok: true,
      found: `.env present (${emptyKeys} empty value(s) still to fill)`,
      required: ".env copied from .env.example with keys filled (only for smoke/e2e)",
      install: "cp .env.example .env",
      blocking: false,
    };
  }
  return {
    name: ".env file [OPTIONAL for just ci]",
    ok: false,
    found: `missing${example === null ? " (.env.example also missing — not a full checkout?)" : ""}`,
    required: ".env copied from .env.example with keys filled (only for smoke/e2e)",
    install: "cp .env.example .env && fill in the keys (see README §1)",
    blocking: false,
  };
}

/** cargo-llvm-cov is only needed for `just coverage`. Optional. */
async function checkLlvmCov(): Promise<Check> {
  const out = await run("cargo-llvm-cov", ["--version"]);
  const ok = out.includes("cargo-llvm-cov");
  return {
    name: "cargo-llvm-cov [OPTIONAL]",
    ok,
    found: ok ? out : "missing (optional)",
    required: "only for `just coverage`",
    install: "cargo install cargo-llvm-cov",
    blocking: false,
  };
}

/**
 * Circuit test dependencies (mocha + tsx under circuits/). Only needed for
 * `just circuits`. Optional for the merge gate.
 */
async function checkCircuitTestDeps(): Promise<Check> {
  const hasMocha = readTextFile("circuits/node_modules/.package-lock.json") !== null ||
    readTextFile("node_modules/mocha/package.json") !== null;
  return {
    name: "Circuit test deps (mocha) [OPTIONAL]",
    ok: hasMocha,
    found: hasMocha ? "mocha resolvable" : "not installed",
    required: "only for `just circuits` (`npm install` at root provides it)",
    install: "npm install",
    fixCmd: hasMocha ? undefined : "npm install",
    blocking: false,
  };
}

function printCheck(c: Check): void {
  const icon = c.ok ? "✅" : c.blocking === false ? "⚠️" : "❌";
  console.log(`${icon} ${c.name}`);
  console.log(`   found:    ${c.found}`);
  console.log(`   required: ${c.required}`);
  if (!c.ok) {
    console.log(`   install:  ${c.install}`);
    if (c.fix) console.log(`   fix:      ${c.fix}`);
  }
  console.log();
}

async function main(): Promise<void> {
  const autoFix = process.argv.includes("--fix");
  console.log("\n🩺 Sharibo toolchain doctor\n");
  const checks: Check[] = await Promise.all([
    checkRust(),
    checkStellar(),
    checkNode(),
    checkNodePin(),
    checkCircom(),
    checkJust(),
    checkSdkBuilt(),
    checkCircuitArtifacts(),
    checkEnvFile(),
    checkLlvmCov(),
    checkCircuitTestDeps(),
  ]);
  for (const c of checks) printCheck(c);

  if (autoFix) {
    const fixable = checks.filter((c) => !c.ok && c.fixCmd);
    for (const c of fixable) {
      console.log(`🔧 --fix: ${c.fixCmd}`);
      const { execFile: exec } = await import("node:child_process");
      const { promisify: prom } = await import("node:util");
      try {
        const execAsync = prom(exec);
        const [cmd, ...args] = c.fixCmd!.split(" ");
        const { stdout } = await execAsync(cmd, args, { cwd: REPO_ROOT });
        if (stdout.trim()) console.log(stdout.trim());
        console.log(`   ok: ${c.name}`);
      } catch (e) {
        console.log(`   FAILED: ${c.name} — ${(e as Error).message.split("\n")[0]}`);
      }
    }
    console.log("\nRe-run `npm run doctor --workspace=scripts` to verify.\n");
    return;
  }

  const blocking = checks.filter((c) => !c.ok && c.blocking !== false);
  const warnings = checks.filter((c) => !c.ok && c.blocking === false);
  if (warnings.length > 0) {
    console.log(`⚠️  ${warnings.length} optional item(s) above — not needed for \`just ci\`.`);
  }
  if (blocking.length > 0) {
    console.log(`❌ ${blocking.length} blocking issue(s) found. Fix the red items above and re-run.`);
    console.log(`   (Tip: \`npm run doctor --workspace=scripts -- --fix\` resolves the mechanical ones.)`);
    process.exit(1);
  }
  console.log("✅ Blocking checks pass — `just ci` should be green from here.");
}

main().catch((e) => {
  console.error("doctor failed:", e);
  process.exit(1);
});
