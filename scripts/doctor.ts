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
};

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
  const required = "stellar >= v21.0";
  if (out.startsWith("stellar ")) {
    const version = out.split(" ")[1];
    const ok = semverCompare(version, "21.0.0") >= 0;
    return {
      name: "stellar CLI",
      ok,
      found: out,
      required,
      install: "curl -sSL https://github.com/stellar/stellar-core/releases/download/v21.0/stellar-core-21.0.tar.gz | tar -xz && install stellar /usr/local/bin",
      fix: ok ? undefined : "Install stellar CLI v21.0+",
    };
  }
  return {
    name: "stellar CLI",
    ok: false,
    found: "missing",
    required,
    install: "See https://developers.stellar.org/docs/tools/cli/install-cli",
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
    };
  }
  return {
    name: "Node.js",
    ok: false,
    found: "missing",
    required,
    install: "nvm install 20 || fnm install 20 || https://nodejs.org/en/download/",
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
      name: "circom",
      ok: versionOk && primeOk,
      found: `${out} | bls12381 support: ${primeOk}`,
      required,
      install: "git clone https://github.com/iden3/circom.git && cd circom && cargo build --release && cargo install --path circom",
      fix: primeOk ? undefined : "Build circom from source with --features bls12381 (see docs/troubleshooting.md)",
    };
  }
  return {
    name: "circom",
    ok: false,
    found: "missing",
    required,
    install: "git clone https://github.com/iden3/circom.git && cd circom && cargo build --release && cargo install --path circom",
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

function printCheck(c: Check): void {
  const icon = c.ok ? "✅" : "❌";
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
  console.log("\n🩺 Sharibo toolchain doctor\n");
  const checks: Check[] = await Promise.all([
    checkRust(),
    checkStellar(),
    checkNode(),
    checkCircom(),
    checkJust(),
  ]);
  for (const c of checks) printCheck(c);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    console.log(`❌ ${failed.length} issue(s) found. Fix the red items above and re-run.`);
    process.exit(1);
  }
  console.log("✅ Toolchain looks good. Run `just circuits` to compile circuits.");
}

main().catch((e) => {
  console.error("doctor failed:", e);
  process.exit(1);
});
