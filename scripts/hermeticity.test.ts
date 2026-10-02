// Guard rail for the hermeticity rule (see CONTRIBUTING.md and #512).
//
// The rule: the default suite (`npm test`) must pass with networking disabled,
// and must never spend friendbot quota or depend on a third-party service.
//
// A convention nobody checks regresses, so this file is the check. It asserts
// two things:
//
//   1. The naming invariant that keeps live tests out of the default run.
//      Node's `--test` glob has NO exclusion syntax - passing "!*.live.test.ts"
//      is silently ignored, and "*.test.ts" matches "*.live.test.ts" anyway.
//      So live tests are named "*.live.ts" precisely because that suffix can
//      never be picked up by a "*.test.ts" glob. Do not "fix" this back to
//      "*.live.test.ts"; it looks right and is not.
//   2. That no file in the default glob names a host outside the allowlist.
//
// Add network assertions to a `*.live.ts` file, run via `npm run test:live`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(readFileSync(path.join(scriptsDir, "package.json"), "utf8"));

/**
 * Hostnames a hermetic test is allowed to name.
 *
 * - localhost / 127.0.0.1 / ::1 — a server another test started in-process
 *   (see smoke.test.ts).
 * - RFC 2606 / RFC 6761 reserved TLDs — guaranteed never to resolve, so naming
 *   one can never become a real request. `*.invalid` and `*.test` qualify.
 */
const ALLOWED_HOST_SUFFIXES = ["localhost", "127.0.0.1", "::1", ".invalid", ".test", ".example"];

/**
 * Matches the host component of an absolute http(s) URL.
 *
 * Deliberately narrow: it stops at the first character that cannot appear in a
 * hostname, so a URL built with a template literal — for example
 * `http://127.0.0.1:<port>` — yields the host instead of swallowing the
 * interpolation into the match. The bracket alternative covers IPv6 literals.
 */
const HOST_IN_URL = /https?:\/\/(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9._-]+)/g;

function isAllowedHost(hostname: string): boolean {
  const bare = hostname.replace(/^\[/, "").replace(/\]$/, "");
  return ALLOWED_HOST_SUFFIXES.some((suffix) =>
    suffix.startsWith(".") ? bare.endsWith(suffix) : bare === suffix,
  );
}

const allFiles = readdirSync(scriptsDir).sort();
/** Files `npm test` runs: the `*.test.ts` glob, which is not recursive. */
const defaultGlobFiles = allFiles.filter((f) => f.endsWith(".test.ts"));
/** Files `npm run test:live` runs. */
const liveFiles = allFiles.filter((f) => f.endsWith(".live.ts"));

describe("hermeticity guard", () => {
  it("the default glob matches at least one test file", () => {
    assert.ok(defaultGlobFiles.length > 0, "expected the default glob to match test files");
  });

  it("the default and live scripts use disjoint globs", () => {
    // If these ever overlap, every live assertion is back in the default run.
    assert.match(pkg.scripts.test, /--test\s+"?\*\.test\.ts"?$/, "test must glob only *.test.ts");
    assert.match(pkg.scripts["test:live"], /--test\s+"?\*\.live\.ts"?$/, "test:live must glob only *.live.ts");
  });

  it("has no file that both globs would match", () => {
    const overlap = defaultGlobFiles.filter((f) => f.endsWith(".live.ts"));
    assert.deepEqual(
      overlap,
      [],
      `in both the default and live globs: ${overlap.join(", ")}`,
    );
  });

  it("names every live file with the .live.ts suffix", () => {
    const misnamed = allFiles.filter(
      (f) => f.includes(".live.") && !f.endsWith(".live.ts") && !f.endsWith(".live.test.ts"),
    );
    assert.deepEqual(
      misnamed,
      [],
      "a live test must end in .live.ts; " +
        "Node's --test glob cannot exclude files, and '*.test.ts' matches " +
        "'*.live.test.ts', so that name would run in the default suite.",
    );
  });

  it("finds live tests to check for", () => {
    // Guards against the whole guard going vacuous if the naming is broken.
    assert.ok(liveFiles.length > 0, "expected at least one *.live.ts file");
  });

  for (const file of defaultGlobFiles) {
    it(`${file} names no host outside the hermetic allowlist`, () => {
      const src = readFileSync(path.join(scriptsDir, file), "utf8");
      const offenders: string[] = [];

      for (const match of src.matchAll(HOST_IN_URL)) {
        if (!isAllowedHost(match[1])) offenders.push(match[1]);
      }

      assert.deepEqual(
        [...new Set(offenders)],
        [],
        `${file} references a real host. Move the assertion to a *.live.ts file, ` +
          `or point it at a local http.createServer.`,
      );
    });
  }
});
