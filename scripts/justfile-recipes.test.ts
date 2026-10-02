import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guard from #459 / #572: just silently shadows duplicate recipe names, so a
 * second `verify:` can hide the documented gate. Fail the suite if any name
 * is defined more than once.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const justfilePath = path.join(root, "justfile");

describe("justfile recipes", () => {
  it("has no duplicate recipe names", () => {
    const source = fs.readFileSync(justfilePath, "utf8");
    const names = [];
    for (const line of source.split("\n")) {
      // Recipe headers look like `name:` or `name arg:` at column 0.
      // Skip comments, recipes that start with whitespace, and setting lines.
      if (/^\s/.test(line) || line.startsWith("#") || line.startsWith("set ")) continue;
      const match = /^([a-zA-Z][a-zA-Z0-9_-]*)/.exec(line);
      if (!match) continue;
      // A recipe line ends with `:` before any recipe body on later lines.
      if (!line.includes(":")) continue;
      // Ignore `foo := bar` assignments.
      if (/^\w+\s*:=/.test(line)) continue;
      const name = match[1];
      // Skip shebang recipe markers that aren't names — already handled.
      names.push(name);
    }

    const counts = new Map();
    for (const name of names) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([n]) => n);
    assert.deepEqual(dupes, [], `duplicate just recipes: ${dupes.join(", ")}`);
  });

  it("defines the authoritative ci recipe", () => {
    const source = fs.readFileSync(justfilePath, "utf8");
    assert.match(source, /^ci:/m);
    assert.match(source, /^verify:/m);
  });
});
