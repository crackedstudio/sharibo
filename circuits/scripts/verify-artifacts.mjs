import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const circuitsDir = path.resolve(scriptDir, "..");
const fixHint = "run `npm run compile && npm run setup` in `circuits/`";

const artifacts = [
  {
    name: "verification_key.json",
    filePath: path.join(circuitsDir, "verification_key.json"),
    hashPath: path.join(circuitsDir, "verification_key.json.sha256"),
  },
  {
    name: "membership.wasm",
    filePath: path.join(circuitsDir, "build", "membership_js", "membership.wasm"),
    hashPath: path.join(circuitsDir, "membership.wasm.sha256"),
  },
  {
    name: "membership_final.zkey",
    filePath: path.join(circuitsDir, "build", "membership_final.zkey"),
    hashPath: path.join(circuitsDir, "membership_final.zkey.sha256"),
  },
];

function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function readExpectedHash(hashPath) {
  if (!existsSync(hashPath)) return null;

  const raw = readFileSync(hashPath, "utf8").trim();
  const match = raw.match(/[A-Fa-f0-9]{64}/);
  if (match) return match[0].toLowerCase();

  try {
    const parsed = JSON.parse(raw);
    const candidates = [parsed.sha256, parsed.hash, parsed["verification_key.json"], parsed["membership.wasm"], parsed["membership_final.zkey"]];
    for (const candidate of candidates) {
      if (typeof candidate === "string") return candidate.toLowerCase();
    }
  } catch {
    // ignore malformed hash manifests and fail below with a clearer message
  }

  return null;
}

function fail(message) {
  console.error(`Circuit artifact verification failed: ${message}`);
  console.error(`Fix: ${fixHint}`);
  process.exit(1);
}

const manifestPath = path.join(circuitsDir, "artifact-hashes.json");
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : {};

for (const artifact of artifacts) {
  if (!existsSync(artifact.filePath)) {
    fail(`${artifact.name} is missing. ${fixHint}`);
  }

  const expected = readExpectedHash(artifact.hashPath) ?? manifest[artifact.name];

  if (!expected) {
    fail(`No committed SHA-256 hash found for ${artifact.name}. ${fixHint}`);
  }

  const actual = hashFile(artifact.filePath);
  if (actual !== expected.toLowerCase()) {
    fail(
      `${artifact.name} hash mismatch. Expected ${expected.toLowerCase()} but found ${actual}. ${fixHint}`,
    );
  }
}

console.log("Circuit artifacts verified.");
