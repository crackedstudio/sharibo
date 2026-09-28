/**
 * Repository structure invariants (#537).
 *
 * Regression guards that mechanically verify the documentation, configuration
 * and source-tree invariants this repository relies on. Each test derives its
 * expectations from the filesystem / manifest at runtime — nothing here
 * hardcodes today's file list, so a newly added document, ADR, contract error,
 * workspace, stylesheet or top-level directory fails loudly instead of
 * drifting silently.
 *
 * Plain Node test (`node --test`), no tsx and no dependencies, matching the
 * existing `scripts/docs-structure.test.mjs` convention.
 *
 * Run standalone:  node --test scripts/repo-structure.test.mjs
 * Via the workspace: npm test --workspace=scripts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { isArchivedDoc } from "./doc-archive.mjs";
import {
  findUnindexedDocs,
  collectIndexableDocs,
  readAdrs,
  findDuplicateAdrNumbers,
  findAdrHeadingMismatches,
  findAdrsWithoutStatus,
  parseContractErrors,
  findUndocumentedErrors,
  findUndecodedErrors,
  readReadmeStructureBlock,
  findUndocumentedTopLevelDirs,
  findWorkspacesMissingKnipConfig,
  findOrphanCssModules,
  parseVerificationKeyPublicCount,
  parseContractPublicInputCount,
  parseSdkPublicSignalCount,
  satisfiesRange,
  checkDependencyVersions,
  findBrokenLinks,
  walkFiles,
  relPosix,
} from "./repo-structure.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const readJson = (...p) => JSON.parse(read(...p));

/**
 * Workspaces expected to carry each shared tool. Derived from what the
 * repository actually declares, not from the full workspace list —
 * `circuits/` is plain JavaScript and intentionally has no TypeScript.
 */
const TYPESCRIPT_WORKSPACES = ["app", "packages/client", "packages/core", "scripts"];
const SDK_WORKSPACES = ["app", "packages/client", "scripts"];

/**
 * Workspaces whose `vitest` version must agree.
 *
 * Scoped to the library workspaces — those declaring `vitest` but not `vite`.
 * `app` is a Vite application and pins `vitest` to the major that matches its
 * `vite` release, so forcing it onto the libraries' major would either break the
 * app or force a major test-runner bump for no benefit. Deriving the group from
 * the manifests (rather than listing names) means a newly added library
 * workspace is checked automatically.
 */
function vitestLockstepWorkspaces(manifests) {
  return Object.entries(manifests)
    .filter(([, pkg]) => {
      const declared = { ...pkg.dependencies, ...pkg.devDependencies };
      return declared.vitest && !declared.vite;
    })
    .map(([ws]) => ws);
}

/** Build an actionable multi-line failure message from a list of problems. */
function bulletList(problems) {
  return problems.map((p) => `  - ${p}`).join("\n");
}

describe("repository structure invariants", () => {
  // ── 1. Docs index complete ────────────────────────────────────────────────
  it("docs/index.md indexes every markdown document under docs/ and the root", () => {
    const missing = findUnindexedDocs(ROOT, isArchivedDoc);
    assert.deepEqual(
      missing.map((m) => m.path),
      [],
      `docs/index.md is missing ${missing.length} documentation file(s).\n` +
        `Add a row for each to docs/index.md (the link is resolved relative to docs/):\n` +
        bulletList(missing.map((m) => `${m.path}  ->  ](${m.target})`)),
    );
  });

  it("the indexed doc set is non-empty (guards the check above from passing vacuously)", () => {
    const docs = collectIndexableDocs(ROOT, isArchivedDoc);
    assert.ok(
      docs.length > 0,
      "no indexable docs were discovered — the docs/ walk is broken, so invariant 1 would pass for the wrong reason",
    );
  });

  it("archived docs are excluded from the index requirement", () => {
    // docs/hackathon/** is an explicit archive allowlist (scripts/doc-archive.mjs);
    // an archive is allowed to contain files the live index does not list.
    const docs = collectIndexableDocs(ROOT, isArchivedDoc);
    assert.ok(
      !docs.some((d) => d.startsWith("docs/hackathon/")),
      "docs/hackathon/** must stay out of the indexable set",
    );
  });

  // ── 2. ADR numbering ─────────────────────────────────────────────────────
  it("ADR filenames are uniquely numbered", () => {
    const duplicates = findDuplicateAdrNumbers(readAdrs(ROOT));
    assert.deepEqual(
      duplicates,
      [],
      `ADR numbers must be unique (see KNOWN_SHARED_ADR_NUMBERS in scripts/repo-structure.mjs for the one intentional exception).\n` +
        bulletList(
          duplicates.map((d) => `ADR ${d.number} is claimed by: ${d.files.join(", ")}`),
        ),
    );
  });

  it("each ADR heading number matches its filename number", () => {
    const mismatches = findAdrHeadingMismatches(readAdrs(ROOT));
    assert.deepEqual(
      mismatches,
      [],
      `ADR heading and filename disagree.\n` +
        bulletList(
          mismatches.map(
            (m) =>
              `${m.file} declares '# ADR ${m.headingNumber}:'; filename expects ADR ${m.filenameNumber}`,
          ),
        ),
    );
  });

  it("every ADR declares a Status", () => {
    const withoutStatus = findAdrsWithoutStatus(readAdrs(ROOT));
    assert.deepEqual(
      withoutStatus,
      [],
      `every ADR must carry a 'Status:' line.\n` +
        bulletList(withoutStatus.map((f) => `${f} has no 'Status:' line`)),
    );
  });

  it("ADRs are discovered dynamically, not from a fixed list", () => {
    const adrs = readAdrs(ROOT);
    assert.ok(
      adrs.length > 0,
      "no ADRs discovered under docs/adr/ — the walk is broken, so invariant 2 would pass for the wrong reason",
    );
    for (const adr of adrs) {
      assert.match(adr.file, /^docs\/adr\/\d+[-.]/, `${adr.file} is not NNN-named`);
    }
  });

  // ── 3. Error table completeness ───────────────────────────────────────────
  it("every #[contracterror] variant is documented in docs/errors.md", () => {
    const errors = parseContractErrors(read("contracts", "sharibo", "src", "lib.rs"));
    const undocumented = findUndocumentedErrors(errors, read("docs", "errors.md"));
    assert.deepEqual(
      undocumented.map((e) => e.code),
      [],
      `docs/errors.md is missing rows for ${undocumented.length} contract error(s).\n` +
        `Add a '| <code> | \`<Variant>\` | ... |' row for each:\n` +
        bulletList(undocumented.map((e) => `Contract error ${e.code} / ${e.name} is missing from docs/errors.md`)),
    );
  });

  it("every #[contracterror] variant is decoded in decodeError.ts", () => {
    const errors = parseContractErrors(read("contracts", "sharibo", "src", "lib.rs"));
    const undecoded = findUndecodedErrors(errors, read("packages", "client", "src", "decodeError.ts"));
    assert.deepEqual(
      undecoded.map((e) => e.code),
      [],
      `packages/client/src/decodeError.ts is missing mappings for ${undecoded.length} contract error(s).\n` +
        `Add a 'case <code>:' arm in createContractError() (and the subclass in errors.ts) for each:\n` +
        bulletList(undecoded.map((e) => `Contract error ${e.name} is missing from decodeError.ts (code ${e.code})`)),
    );
  });

  it("the contracterror parser finds the real enum (guards invariant 3 from passing vacuously)", () => {
    const errors = parseContractErrors(read("contracts", "sharibo", "src", "lib.rs"));
    assert.ok(
      errors.length > 0,
      "no #[contracterror] variants parsed — the parser no longer matches lib.rs",
    );
    for (const e of errors) {
      assert.equal(typeof e.code, "number");
      assert.ok(e.code > 0, `${e.name} has a non-positive discriminant`);
    }
  });

  // ── 4. README repository structure ────────────────────────────────────────
  it("README's repository structure section documents every top-level directory", () => {
    const block = readReadmeStructureBlock(read("README.md"));
    const missing = findUndocumentedTopLevelDirs(ROOT, block);
    assert.deepEqual(
      missing,
      [],
      `README.md '## Repository structure' does not list ${missing.length} top-level directory(ies).\n` +
        `Add an entry for each to the fenced tree in that section:\n` +
        bulletList(missing.map((d) => `${d}/ is not documented in README.md '## Repository structure'`)),
    );
  });

  // ── 5. No orphan workspaces ───────────────────────────────────────────────
  it("every workspace in package.json has a knip configuration block", () => {
    const workspaces = readJson("package.json").workspaces;
    const missing = findWorkspacesMissingKnipConfig(workspaces, read("knip.jsonc"));
    assert.deepEqual(
      missing,
      [],
      `${missing.length} workspace(s) have no entry in knip.jsonc's "workspaces" block, ` +
        `so they are invisible to \`npm run lint:dead\` (#${missing.length > 0 ? "537" : ""}).\n` +
        `Add an entry (with its real \`entry\` points) for each:\n` +
        bulletList(missing.map((ws) => `${ws} (package.json workspaces) has no knip.jsonc "workspaces" block`)),
    );
  });

  it("workspaces are discovered from package.json, not a fixed list", () => {
    const workspaces = readJson("package.json").workspaces;
    assert.ok(Array.isArray(workspaces) && workspaces.length > 0, "package.json has no workspaces array");
    // Knip itself treats the root manifest as a workspace key; ignore it here so
    // the assertion below is about real code workspaces only.
    const real = workspaces.filter((w) => w !== ".");
    assert.ok(
      real.length > 0,
      "no code workspaces found — invariant 5 would pass for the wrong reason",
    );
  });

  // ── 6. No orphan stylesheets ──────────────────────────────────────────────
  it("every app CSS module is imported by a component", () => {
    const orphans = findOrphanCssModules(join(ROOT, "app"));
    assert.deepEqual(
      orphans,
      [],
      `${orphans.length} CSS module(s) exist but nothing in app/src imports them.\n` +
        `Import the stylesheet from the component that owns it, or delete it:\n` +
        bulletList(orphans.map((f) => `app/${f} is not imported by any file under app/src`)),
    );
  });

  it("CSS modules are discovered dynamically (guards invariant 6 from passing vacuously)", () => {
    const modules = walkFiles(join(ROOT, "app", "src")).filter((f) => f.endsWith(".module.css"));
    assert.ok(
      modules.length > 0,
      "no app/src/**/*.module.css files were discovered — the walk is broken, so invariant 6 would pass for the wrong reason",
    );
  });

  // ── 7. Wire-format agreement ──────────────────────────────────────────────
  it("public signal count agrees across circuit, contract and SDK", () => {
    const vkCount = parseVerificationKeyPublicCount(readJson("circuits", "verification_key.json"));
    const contractCount = parseContractPublicInputCount(read("contracts", "sharibo", "src", "lib.rs"));
    const sdkCount = parseSdkPublicSignalCount(readJson("test-vectors", "public-signals.json"));
    assert.equal(
      contractCount,
      vkCount,
      `Public input count mismatch: verification_key=${vkCount}, contract=${contractCount}, SDK=${sdkCount}. ` +
        `Regenerate the trusted setup (circuits: npm run setup) and coordinate circuit, contract and SDK.`,
    );
    assert.equal(
      sdkCount,
      vkCount,
      `Public input count mismatch: verification_key=${vkCount}, contract=${contractCount}, SDK=${sdkCount}. ` +
        `Update test-vectors/public-signals.json and the SDK encoding.`,
    );
  });

  // ── 8. Node version agreement ─────────────────────────────────────────────
  it("the .nvmrc pin satisfies the root package.json engines.node range", () => {
    const engines = readJson("package.json").engines;
    assert.ok(
      engines && typeof engines.node === "string",
      'package.json has no engines.node — invariant 8 needs a declared range to check .nvmrc against. ' +
        'Add e.g. "engines": { "node": ">=20.6.0" } (the minimum documented in README.md §0).',
    );
    const nvmrc = read(".nvmrc").trim();
    assert.ok(nvmrc, ".nvmrc is empty — there is no Node version pin to check");
    assert.ok(
      satisfiesRange(nvmrc, engines.node),
      `.nvmrc (${nvmrc}) does not satisfy package.json engines.node (${engines.node}). ` +
        `Update one so a contributor's pinned Node matches the declared range.`,
    );
  });

  // ── 9. Dependency version agreement ───────────────────────────────────────
  it("typescript is declared at a single version across the TS workspaces", () => {
    const result = checkDependencyVersions(loadManifests(), "typescript", TYPESCRIPT_WORKSPACES);
    assert.ok(
      result.ok,
      `typescript version drift across workspaces.\n` + formatDependencyProblem("typescript", result),
    );
  });

  it("vitest is declared at a single version across the library workspaces", () => {
    const manifests = loadManifests();
    const lockstep = vitestLockstepWorkspaces(manifests);
    assert.ok(
      lockstep.length > 0,
      "no library workspace declares vitest — invariant 9 would pass for the wrong reason",
    );
    const result = checkDependencyVersions(manifests, "vitest", lockstep);
    assert.ok(
      result.ok,
      `vitest version drift across the library workspaces (${lockstep.join(", ")}).\n` +
        formatDependencyProblem("vitest", result),
    );
  });

  it("the shared @stellar/stellar-sdk pin is still single-versioned", () => {
    // Regression cover for the pre-existing maintenance check
    // (scripts/maintenance/check-stellar-sdk-version.mjs); asserted here so
    // the whole dependency policy lives in one suite.
    const result = checkDependencyVersions(loadManifests(), "@stellar/stellar-sdk", SDK_WORKSPACES);
    assert.ok(
      result.ok,
      `@stellar/stellar-sdk version drift across workspaces.\n` +
        formatDependencyProblem("@stellar/stellar-sdk", result),
    );
  });

  // ── 10. No broken relative markdown links ────────────────────────────────
  it("no markdown file contains a broken relative link", () => {
    const mdFiles = walkFiles(ROOT).filter((f) => f.endsWith(".md"));
    const problems = [];
    for (const file of mdFiles) {
      for (const target of findBrokenLinks(file, readFileSync(file, "utf8"))) {
        problems.push(`${relPosix(ROOT, file)} contains broken relative link: ${target}`);
      }
    }
    assert.deepEqual(
      problems,
      [],
      `${problems.length} broken relative markdown link(s). ` +
        `Fix the path, or point the link at the file's new location:\n` +
        bulletList(problems),
    );
  });

  it("markdown files are discovered dynamically (guards invariant 10 from passing vacuously)", () => {
    const mdFiles = walkFiles(ROOT).filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "no markdown files were walked — invariant 10 would pass for the wrong reason");
  });
});

/**
 * ── Self-tests: prove the guards actually fail on drift ─────────────────────
 *
 * Each case builds a throwaway fixture in the OS temp directory and runs the
 * same check function the suite above uses, asserting it reports the injected
 * problem. Nothing under the repository is created, modified or deleted.
 */
describe("repo-structure guards detect injected drift", () => {
  /** Run `fn` inside a fresh temp dir populated by `build`, then clean up. */
  function withFixture(build, fn) {
    const dir = join(tmpdir(), `sharibo-repo-structure-${process.pid}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    try {
      build(dir);
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const write = (dir, rel, contents) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents, "utf8");
  };

  it("catches a documentation file that is not indexed", () => {
    withFixture(
      (dir) => {
        write(dir, "docs/index.md", "| [`existing.md`](existing.md) | ok |\n");
        write(dir, "docs/existing.md", "# existing\n");
        write(dir, "docs/new-thing.md", "# brand new doc, never added to the index\n");
      },
      (dir) => {
        const missing = findUnindexedDocs(dir, () => false);
        assert.deepEqual(
          missing.map((m) => m.path),
          ["docs/new-thing.md"],
          "the docs-index guard failed to flag an unindexed markdown file",
        );
      },
    );
  });

  it("catches a duplicate ADR number", () => {
    const adrs = [
      { file: "docs/adr/007-a.md", number: "007", heading: "007", hasStatus: true },
      // 007 reused by a second ADR — headings are internally consistent, so only
      // the uniqueness check can catch this.
      { file: "docs/adr/007-b.md", number: "007", heading: "007", hasStatus: true },
    ];
    const duplicates = findDuplicateAdrNumbers(adrs);
    assert.deepEqual(
      duplicates.map((d) => d.number),
      ["007"],
      "the ADR guard failed to flag a duplicated ADR number",
    );
  });

  it("catches an ADR whose heading number disagrees with its filename", () => {
    const mismatches = findAdrHeadingMismatches([
      { file: "docs/adr/006-example.md", number: "006", heading: "007", hasStatus: true },
    ]);
    assert.equal(mismatches.length, 1, "the ADR guard failed to flag a filename/heading mismatch");
    assert.equal(mismatches[0].file, "docs/adr/006-example.md");
  });

  it("catches an ADR with no Status line", () => {
    const without = findAdrsWithoutStatus([
      { file: "docs/adr/009-no-status.md", number: "009", heading: "009", hasStatus: false },
    ]);
    assert.deepEqual(without, ["docs/adr/009-no-status.md"], "the ADR guard failed to flag a missing Status");
  });

  it("catches a contract error that is not in docs/errors.md", () => {
    const errors = [
      { name: "AlreadyClaimed", code: 4 },
      { name: "SomeBrandNewError", code: 10 },
    ];
    const undocumented = findUndocumentedErrors(errors, "| 4 | `AlreadyClaimed` | … |\n");
    assert.deepEqual(
      undocumented,
      [{ name: "SomeBrandNewError", code: 10 }],
      "the error-table guard failed to flag an undocumented contract error",
    );
  });

  it("catches a contract error that is not decoded in decodeError.ts", () => {
    const errors = [
      { name: "AlreadyClaimed", code: 4 },
      { name: "SomeBrandNewError", code: 10 },
    ];
    const undecoded = findUndecodedErrors(errors, "switch (code) {\n  case 4:\n    return x;\n}\n");
    assert.deepEqual(
      undecoded,
      [{ name: "SomeBrandNewError", code: 10 }],
      "the decodeError guard failed to flag an unmapped contract error",
    );
  });

  it("catches a top-level directory missing from the README structure block", () => {
    withFixture(
      (dir) => {
        mkdirSync(join(dir, "app"), { recursive: true });
        mkdirSync(join(dir, "brandnewtool"), { recursive: true });
      },
      (dir) => {
        const block = "sharibo/\n├── app/   the app\n";
        const missing = findUndocumentedTopLevelDirs(dir, block);
        assert.deepEqual(
          missing,
          ["brandnewtool"],
          "the README-structure guard failed to flag an undocumented top-level directory",
        );
      },
    );
  });

  it("catches a workspace with no knip configuration block", () => {
    // Mirrors knip.jsonc's real shape: 2-space `workspaces`, 4-space entries.
    const knip = [
      "{",
      '  "workspaces": {',
      '    "app": {',
      '      "entry": ["src/main.tsx"]',
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    const missing = findWorkspacesMissingKnipConfig(["app", "packages/newthing"], knip);
    assert.deepEqual(
      missing,
      ["packages/newthing"],
      "the workspace guard failed to flag a workspace missing from knip.jsonc",
    );
  });

  it("catches a CSS module that no component imports", () => {
    withFixture(
      (dir) => {
        write(dir, "src/Widget.tsx", 'import styles from "./Widget.module.css";\n');
        write(dir, "src/Widget.module.css", ".a { color: red; }\n");
        write(dir, "src/Orphan.module.css", ".b { color: blue; }\n");
      },
      (dir) => {
        const orphans = findOrphanCssModules(dir);
        assert.deepEqual(
          orphans,
          ["src/Orphan.module.css"],
          "the stylesheet guard failed to flag an orphan CSS module",
        );
      },
    );
  });

  it("catches a broken relative markdown link and ignores external/anchor targets", () => {
    withFixture(
      (dir) => {
        write(dir, "docs/guide.md", "# guide\n");
        write(dir, "circuits/real.circom", "// real\n");
      },
      (dir) => {
        const broken = findBrokenLinks(
          join(dir, "docs", "guide.md"),
          [
            "[ok](./real-file.md)",
            "[broken](./real-file.md)",
            "[gone](../circuits/membership.circom)",
            "[ext](https://example.com/x)",
            "[mail](mailto:a@b.c)",
            "[anchor](#section)",
            "[real](https://example.com)",
            "[also ok](../circuits/real.circom)",
            "[img](../circuits/real%2Ecircom)",
            "[ref][1]\n\n[1]: ./real-file.md\n",
          ].join("\n"),
        );
        assert.deepEqual(
          broken,
          ["./real-file.md", "../circuits/membership.circom"],
          "the markdown-link guard mis-classified broken vs. non-filesystem targets",
        );
      },
    );
  });

  it("catches a Node version pin outside the declared engines range", () => {
    assert.equal(satisfiesRange("20.11.1", ">=20.6.0"), true);
    assert.equal(satisfiesRange("20", ">=20.6.0"), true, "'20' is a 20.x range, not the version 20.0.0");
    assert.equal(satisfiesRange("18.20.0", ">=20.6.0"), false);
    assert.equal(satisfiesRange("22.1.0", ">=20.6.0 <21"), false);
  });

  it("catches dependency version drift across workspaces", () => {
    const manifests = {
      app: { devDependencies: { vitest: "4.1.10" } },
      "packages/client": { devDependencies: { vitest: "^2.1.8" } },
      "packages/core": { devDependencies: { vitest: "^2.1.8" } },
    };
    const result = checkDependencyVersions(manifests, "vitest", [
      "app",
      "packages/client",
      "packages/core",
    ]);
    assert.equal(result.ok, false, "the dependency guard failed to flag vitest drift");
    assert.deepEqual(result.distinct, ["4.1.10", "^2.1.8"]);
  });

  it("accepts a dependency that is absent from a workspace outside its required set", () => {
    // `circuits/` legitimately declares no TypeScript — the guard must not fire
    // for a workspace that is not in the dependency's required list.
    const manifests = {
      app: { devDependencies: { typescript: "6.0.3" } },
      scripts: { devDependencies: { typescript: "6.0.3" } },
      circuits: { devDependencies: { mocha: "11.7.6" } },
    };
    const result = checkDependencyVersions(manifests, "typescript", ["app", "scripts"]);
    assert.equal(result.ok, true, `unexpected drift: ${result.distinct.join(", ")}`);
    assert.deepEqual(result.missing, []);
  });
});

/** Load the manifests of the workspaces named in the root package.json. */
function loadManifests(only) {
  const workspaces = only ?? readJson("package.json").workspaces;
  const manifests = {};
  for (const ws of workspaces) {
    manifests[ws] = readJson(ws, "package.json");
  }
  return manifests;
}

/** Render a dependency-drift result into an actionable failure message. */
function formatDependencyProblem(dep, result) {
  const lines = [
    `  - declared versions: ${[...result.versions.entries()]
      .map(([ws, v]) => `${ws}=${v}`)
      .join(", ")}`,
  ];
  if (result.missing.length > 0) {
    lines.push(`  - not declared at all: ${result.missing.join(", ")}`);
  }
  if (result.outOfGroup.size > 0) {
    lines.push(
      `  - declared outside this lockstep group (not compared): ${[...result.outOfGroup.entries()]
        .map(([ws, v]) => `${ws}=${v}`)
        .join(", ")}`,
    );
  }
  lines.push(
    `  Bump ${dep} in every workspace of the group at once (the policy enforced by scripts/maintenance/check-stellar-sdk-version.mjs).`,
  );
  return lines.join("\n");
}
