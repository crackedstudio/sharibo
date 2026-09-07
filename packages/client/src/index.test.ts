import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as client from "./index.js";

// Types are erased at compile time and so cannot be observed via
// `Object.keys(client)`. We verify them two ways:
//  1. The static `import type { ... }` below fails typecheck if any
//     documented type is missing from the barrel.
//  2. We assert the README's documented type list equals this canonical list,
//     so the two stay in lockstep.
import type {
  Identity,
  MerkleProof,
  CircuitInput,
  ContractProof,
  ContractVerificationKey,
  GenerateProofResult,
  ProofResult,
  ShariboNetworkConfig,
  ShariboClient,
  ShariboSigner,
  FeeEstimate,
  TxResult,
  CircleView,
} from "./index.js";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _canonicalTypes = [
  "Identity",
  "MerkleProof",
  "CircuitInput",
  "ContractProof",
  "ContractVerificationKey",
  "GenerateProofResult",
  "ProofResult",
  "ShariboNetworkConfig",
  "ShariboClient",
  "ShariboSigner",
  "FeeEstimate",
  "TxResult",
  "CircleView",
] as const;

const __dirname = dirname(fileURLToPath(import.meta.url));
const readmePath = join(__dirname, "..", "README.md");

/**
 * Extract the one-line identifier list from the `## Public API` README section
 * that follows a `### <header>` heading.
 */
function readDocumentedNames(readme: string, header: string): string[] {
  const idx = readme.indexOf(`### ${header}`);
  if (idx === -1) {
    throw new Error(`README is missing a "### ${header}" section`);
  }
  const rest = readme.slice(idx);
  const fence = /```ts\n([^`]*?)```/.exec(rest);
  if (!fence) {
    throw new Error(`README "### ${header}" section has no \`\`\`ts code block`);
  }
  return fence[1]
    .split("\n")
    .map((line) => line.trim())
    // Keep only bare identifiers; ignore blanks and prose.
    .filter((line) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(line))
    .sort();
}

describe("@sharibo/client barrel vs README", () => {
  const readme = readFileSync(readmePath, "utf8");
  const documentedValues = readDocumentedNames(readme, "Values");
  const documentedTypes = readDocumentedNames(readme, "Types");

  it("contains no `export *` in index.ts", () => {
    const indexSrc = readFileSync(join(__dirname, "index.ts"), "utf8");
    expect(indexSrc.match(/export\s*\*/)).toBeNull();
  });

  it("documents no value that is also a type (or vice versa)", () => {
    expect(documentedTypes.some((t) => documentedValues.includes(t))).toBe(false);
  });

  it("the barrel's value exports exactly match the README 'Values' list", () => {
    const exportedValues = Object.keys(client).sort();
    expect(exportedValues).toEqual(documentedValues);
  });

  it("the README 'Types' list matches the canonical public type set", () => {
    expect(documentedTypes).toEqual([..._canonicalTypes].sort());
  });
});