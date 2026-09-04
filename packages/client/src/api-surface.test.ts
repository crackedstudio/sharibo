/**
 * API surface snapshot test.
 *
 * Verifies that the public exports from @sharibo/client match the committed
 * snapshot. This catches accidental name changes, removals, or additions to
 * the public API.
 *
 * When intentional API changes occur, update `api-surface.json` alongside
 * the code change and commit both files together. See CONTRIBUTING.md for
 * guidance.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as pkg from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const snapshotPath = path.join(__dirname, "..", "api-surface.json");
const snapshotJson = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));

test("API surface snapshot matches committed snapshot", () => {
  // Collect all exported names and their types
  const exported: Record<string, string> = {};

  for (const [name, value] of Object.entries(pkg)) {
    exported[name] = typeof value;
  }

  // Group by category for better readability
  const constants: Record<string, string> = {};
  const functions: Record<string, string> = {};
  const types: Record<string, string> = {};
  const errors: Record<string, string> = {};

  for (const [name, typeOf] of Object.entries(exported)) {
    if (name in snapshotJson.constants) {
      constants[name] = typeOf;
    } else if (name in snapshotJson.errors) {
      errors[name] = "class";
    } else if (name === "MerkleTree") {
      types[name] = "class";
    } else if (typeOf === "function") {
      functions[name] = typeOf;
    }
  }

  // Verify exported type and interface declarations from source files
  const srcFiles = [
    "identity.ts",
    "tree.ts",
    "prove.ts",
    "contract.ts",
    "config.ts",
    "errors.ts",
    "artifacts.ts",
  ];
  const srcContent = srcFiles
    .map((f) => fs.readFileSync(path.join(__dirname, f), "utf8"))
    .join("\n");

  for (const [name, kind] of Object.entries(snapshotJson.types)) {
    if (kind !== "class") {
      const re = new RegExp(`export\\s+(?:type\\s+)?(?:interface|type)\\s+${name}\\b`);
      if (re.test(srcContent)) {
        types[name] = kind as string;
      }
    }
  }

  // Sort each category for consistent comparison
  const sortedSnapshot = {
    constants: Object.fromEntries(Object.entries(snapshotJson.constants).sort()),
    functions: Object.fromEntries(Object.entries(snapshotJson.functions).sort()),
    types: Object.fromEntries(Object.entries(snapshotJson.types).sort()),
    errors: Object.fromEntries(Object.entries(snapshotJson.errors).sort()),
  };

  const sortedActual = {
    constants: Object.fromEntries(Object.entries(constants).sort()),
    functions: Object.fromEntries(Object.entries(functions).sort()),
    types: Object.fromEntries(Object.entries(types).sort()),
    errors: Object.fromEntries(Object.entries(errors).sort()),
  };

  // Compare
  try {
    assert.deepStrictEqual(sortedActual, sortedSnapshot);
  } catch (error) {
    console.error("\n❌ API surface mismatch!");
    console.error("\nExpected snapshot:");
    console.error(JSON.stringify(sortedSnapshot, null, 2));
    console.error("\nActual exports:");
    console.error(JSON.stringify(sortedActual, null, 2));
    throw error;
  }
});

