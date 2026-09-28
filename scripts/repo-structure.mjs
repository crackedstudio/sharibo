/**
 * Repository-structure invariant checks (#537).
 *
 * Pure, filesystem-driven helpers. Every exported function takes an explicit
 * root (or file map) so the same logic can be pointed at a throwaway fixture
 * directory — that is how the "the guard actually fails" cases in
 * `repo-structure.test.mjs` are proven without touching real project files.
 *
 * The style follows the existing maintenance helpers in this directory
 * (`doc-archive.mjs`, `check-stellar-sdk-version.mjs`): plain ESM, node: builtins
 * only, no build step and no runtime dependencies.
 *
 * Parsing notes: the working tree uses CRLF line endings, so every regex here
 * tolerates `\r\n` rather than assuming `\n`.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve, basename } from "node:path";

// ── Shared filesystem helpers ───────────────────────────────────────────────

/** Directories never descended into: VCS, dependency trees and build output. */
export const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  "coverage",
  ".next",
  ".turbo",
  ".vite",
  ".stryker-tmp",
]);

/** Top-level directories that are tooling scaffolding, not project source. */
export const NON_SOURCE_TOP_LEVEL_DIRS = new Set([
  // Editor / repo metadata
  ".github",
  ".vscode",
  // Vitest manual-mock root (fixtures, imported via moduleNameMapper)
  "__mocks__",
]);

/** posix-normalised, repo-relative path of `abs` under `root`. */
export function relPosix(root, abs) {
  return relative(root, abs).split("\\").join("/");
}

/** Recursively collect every file under `dir`, skipping {@link SKIP_DIRS}. */
export function walkFiles(dir, skip = SKIP_DIRS, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walkFiles(abs, skip, out);
    else out.push(abs);
  }
  return out;
}

/** Immediate subdirectory names of `dir`, excluding {@link SKIP_DIRS}. */
export function listDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => !SKIP_DIRS.has(n))
    .filter((n) => statSync(join(dir, n)).isDirectory())
    .sort();
}

// ── 1. Docs index completeness ──────────────────────────────────────────────

/**
 * Every Markdown document that `docs/index.md` is expected to represent:
 * all `*.md` under `docs/` plus the repository-root `*.md` files.
 *
 * `docs/index.md` itself is excluded (it is the index, not an entry), and
 * archived trees are skipped through the repository's own allowlist
 * (`scripts/doc-archive.mjs`) — an archive is allowed to hold stale claims.
 *
 * @param {string} root repository root
 * @param {(p: string) => boolean} isArchived
 * @returns {string[]} posix, repo-relative doc paths, sorted
 */
export function collectIndexableDocs(root, isArchived) {
  const docsDir = join(root, "docs");
  const found = [];

  for (const abs of walkFiles(docsDir)) {
    if (!abs.endsWith(".md")) continue;
    const rel = relPosix(root, abs);
    if (rel === "docs/index.md") continue;
    if (isArchived(rel)) continue;
    found.push(rel);
  }

  for (const name of readdirSync(root).sort()) {
    if (!name.endsWith(".md")) continue;
    if (statSync(join(root, name)).isFile()) found.push(name);
  }

  return found.sort();
}

/**
 * Docs that exist on disk but have no link pointing at them from
 * `docs/index.md`. The index links relative to `docs/`, so both the
 * docs-relative form (`adr/001-x.md`) and the escaped root form
 * (`../CONTRIBUTING.md`) are accepted.
 *
 * @returns {{ path: string, target: string }[]} one entry per unindexed doc,
 *   where `target` is the link form `docs/index.md` would have to contain.
 */
export function findUnindexedDocs(root, isArchived) {
  const indexPath = join(root, "docs", "index.md");
  const index = readFileSync(indexPath, "utf8");
  const missing = [];

  for (const rel of collectIndexableDocs(root, isArchived)) {
    const target = rel.startsWith("docs/") ? rel.slice("docs/".length) : `../${rel}`;
    // Accept both `](target)` and `](/target)` (absolute-from-docs-root) forms.
    const linked =
      index.includes(`](${target})`) || index.includes(`](/${target})`) || index.includes(`](${target}#`);
    if (!linked) missing.push({ path: rel, target });
  }

  return missing;
}

// ── 2. ADR numbering ────────────────────────────────────────────────────────

/**
 * ADR numbers that are intentionally shared by more than one file.
 *
 * `003` is a historical cluster: four ADRs were filed under the same number
 * before the sequence was tightened. `docs/index.md` already disambiguates them
 * by topic ("ADR 003 (fees)"). Renumbering would invalidate the many prose
 * references to ADR 001/003/004/005/006 across the README, `lib.rs` and
 * `docs/wire-format.md`, so the collision is recorded here instead.
 *
 * Any *new* duplicate number still fails the invariant.
 */
export const KNOWN_SHARED_ADR_NUMBERS = new Set(["003"]);

/**
 * Read an ADR's declared number from its `# ADR NNN:` heading.
 * @returns {string | null}
 */
export function parseAdrHeadingNumber(content) {
  const m = /^#\s+ADR\s+(\d+)/m.exec(content);
  return m ? m[1] : null;
}

/** Whether an ADR carries a `Status:` line (bold or plain, list item or not). */
export function hasAdrStatus(content) {
  return /^[\s>*+-]*\**\s*Status\s*:/im.test(content);
}

/**
 * Parse the `docs/adr/` tree into ADR records.
 *
 * @param {string} root repository root
 * @returns {{ file: string, number: string | null, heading: string | null,
 *   hasStatus: boolean }[]} sorted by filename
 */
export function readAdrs(root) {
  const dir = join(root, "docs", "adr");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".md"))
    .sort()
    .map((name) => {
      const content = readFileSync(join(dir, name), "utf8");
      const number = /^(\d+)[-.]/.exec(name)?.[1] ?? null;
      return {
        file: `docs/adr/${name}`,
        number,
        heading: parseAdrHeadingNumber(content),
        hasStatus: hasAdrStatus(content),
      };
    });
}

/** ADR filenames whose `NNN-` prefix is duplicated outside the known set. */
export function findDuplicateAdrNumbers(adrs) {
  const byNumber = new Map();
  for (const adr of adrs) {
    if (!adr.number) continue;
    if (!byNumber.has(adr.number)) byNumber.set(adr.number, []);
    byNumber.get(adr.number).push(adr.file);
  }
  const duplicates = [];
  for (const [number, files] of byNumber) {
    if (files.length > 1 && !KNOWN_SHARED_ADR_NUMBERS.has(number)) {
      duplicates.push({ number, files });
    }
  }
  return duplicates;
}

/** ADRs whose `# ADR NNN:` heading disagrees with their filename number. */
export function findAdrHeadingMismatches(adrs) {
  return adrs
    .filter((adr) => adr.heading !== null && adr.number !== null && adr.heading !== adr.number)
    .map((adr) => ({
      file: adr.file,
      filenameNumber: adr.number,
      headingNumber: adr.heading,
    }));
}

/** ADRs missing the mandatory `Status:` line. */
export function findAdrsWithoutStatus(adrs) {
  return adrs.filter((adr) => !adr.hasStatus).map((adr) => adr.file);
}

// ── 3. Error table completeness ─────────────────────────────────────────────

/**
 * Parse the `#[contracterror]` enum out of the Soroban contract source.
 *
 * Deliberately a shape-specific parser, not a Rust parser: it only supports
 * the repository's actual layout — a `#[contracterror]` attribute followed by a
 * `pub enum Error { Variant = N, ... }` block of explicit discriminants.
 * Both `=` and `:` forms are accepted so a repr change does not silently drop
 * codes.
 *
 * @param {string} source contents of `contracts/sharibo/src/lib.rs`
 * @returns {{ name: string, code: number }[]}
 */
export function parseContractErrors(source) {
  const enumMatch = /#\[contracterror\][\s\S]*?pub\s+enum\s+\w+\s*\{([\s\S]*?)\n\}/.exec(source);
  if (!enumMatch) {
    throw new Error(
      "no #[contracterror] enum found — the contract error table moved; " +
        "update parseContractErrors() to match the new shape",
    );
  }

  const errors = [];
  for (const line of enumMatch[1].split(/\r?\n/)) {
    // Strip `///` doc comments so documentation prose cannot be read as a variant.
    const withoutDoc = line.replace(/^\s*\/\/.*$/, "");
    const m = /^\s*([A-Z][A-Za-z0-9_]*)\s*(?:=|:)\s*([0-9]+)\s*,?/.exec(withoutDoc);
    if (m) errors.push({ name: m[1], code: Number(m[2]) });
  }
  return errors;
}

/** `#[contracterror]` variants absent from a Markdown table in `docs/errors.md`. */
export function findUndocumentedErrors(errors, errorsMd) {
  return errors.filter((e) => !errorsMd.includes(`\`${e.name}\``));
}

/**
 * `#[contracterror]` variants with no `case <code>:` arm in `decodeError.ts`.
 *
 * Keyed on the numeric discriminant because that is what
 * `createContractError()` switches on and what the `Error(Contract, #N)` RPC
 * string carries — the variant name never appears in that file.
 */
export function findUndecodedErrors(errors, decodeErrorSource) {
  return errors.filter((e) => !new RegExp(`case\\s+${e.code}\\s*:`).test(decodeErrorSource));
}

// ── 4. README repository structure ──────────────────────────────────────────

/**
 * Extract the ASCII tree from README's "Repository structure" fenced block.
 * @returns {string | null} the block body, or `null` if the section is missing
 */
export function readReadmeStructureBlock(readme) {
  const m = /##\s+Repository structure[^\S\r\n]*\r?\n[^\S\r\n]*\r?\n```[^\S\r\n]*\r?\n([\s\S]*?)```/.exec(
    readme,
  );
  return m ? m[1] : null;
}

/**
 * Top-level source directories that the README structure block omits.
 *
 * @param {string} root repository root
 * @param {string} block the fenced block from {@link readReadmeStructureBlock}
 * @returns {string[]} missing directory names, sorted
 */
export function findUndocumentedTopLevelDirs(root, block) {
  if (block === null) {
    throw new Error(
      'README.md has no "## Repository structure" fenced block — ' +
        "invariant 4 needs a section to anchor to",
    );
  }
  return listDirs(root)
    .filter((name) => !NON_SOURCE_TOP_LEVEL_DIRS.has(name))
    .filter((name) => !block.includes(`${name}/`));
}

// ── 5. No orphan workspaces ─────────────────────────────────────────────────

/**
 * Strip `//` and block comments from a JSONC document so it can be
 * `JSON.parse`d. Comment markers inside string literals are preserved.
 */
export function stripJsonComments(source) {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Workspace names configured in knip's `workspaces` block.
 * @param {string} knipSource contents of `knip.jsonc`
 * @returns {string[]}
 */
export function parseKnipWorkspaces(knipSource) {
  const config = JSON.parse(stripJsonComments(knipSource));
  return Object.keys(config.workspaces ?? {});
}

/** Workspaces from `package.json` that have no knip configuration block. */
export function findWorkspacesMissingKnipConfig(workspaces, knipSource) {
  const configured = new Set(parseKnipWorkspaces(knipSource));
  return workspaces.filter((ws) => !configured.has(ws));
}

// ── 6. No orphan stylesheets ────────────────────────────────────────────────

/**
 * CSS modules under `app/src` that no component imports.
 *
 * Import detection is restricted to `app/src/**` TypeScript/TSX and JSX, which
 * is where Vite resolves CSS-module specifiers from; a bare repo-wide text
 * search would count an unrelated mention as an import.
 *
 * @returns {string[]} posix, app-root-relative stylesheet paths, sorted
 */
export function findOrphanCssModules(appRoot) {
  const srcRoot = join(appRoot, "src");
  const files = walkFiles(srcRoot);

  const stylesheets = files.filter((f) => f.endsWith(".module.css"));
  const sources = files.filter((f) => /\.(?:tsx?|jsx?)$/.test(f));
  const sourceText = sources.map((f) => readFileSync(f, "utf8"));

  return stylesheets
    .filter((abs) => {
      const specifier = `./${basename(abs)}`;
      return !sourceText.some((text) => text.includes(specifier));
    })
    .map((abs) => relPosix(appRoot, abs))
    .sort();
}

// ── 7. Wire-format agreement ────────────────────────────────────────────────

/** `nPublic` from a snarkjs verification key. */
export function parseVerificationKeyPublicCount(vk) {
  return vk.nPublic;
}

/** `PUBLIC_INPUT_COUNT` from the Rust contract source. */
export function parseContractPublicInputCount(source) {
  const m = /const\s+PUBLIC_INPUT_COUNT\s*:\s*u32\s*=\s*(\d+)/.exec(source);
  if (!m) {
    throw new Error("PUBLIC_INPUT_COUNT not found in contracts/sharibo/src/lib.rs");
  }
  return Number(m[1]);
}

/** Public-signal count declared by the SDK manifest (`test-vectors/public-signals.json`). */
export function parseSdkPublicSignalCount(manifest) {
  return manifest.order.length;
}

// ── 8. Node version agreement ───────────────────────────────────────────────

/**
 * Minimal semver range handling for the operators this repository uses:
 * `>=`, `>`, `<=`, `<`, `=`, `^`, `~`, `x`/`*` wildcards, `||` unions and
 * space-separated intersections. Deliberately dependency-free — the repo does
 * not declare `semver`, and this is the only place a range is compared.
 *
 * A *partial* specifier (`20`, `20.6`, `20.x`) denotes a range over its prefix
 * rather than a single version, which matters for `.nvmrc`: `20` means "the
 * latest 20.x", not "20.0.0". Both sides are therefore expanded into
 * `[lo, hi]` intervals and intersected, so `20` correctly satisfies `>=20.6.0`
 * while `18` does not.
 *
 * @param {string} version a version or partial version, e.g. "20.11.1" / "20"
 * @param {string} range a range expression, e.g. ">=20.6.0 <21"
 */
export function satisfiesRange(version, range) {
  const left = expand(version);
  const right = expand(range);
  if (left === null || right === null) return false;
  // Intervals are half-open `[lo, hi)`, so the upper bounds compare strictly.
  // Arrays are compared with `compare()`, not `<`: JavaScript's relational
  // operators would coerce `[20, 6, 0]` to a string and compare lexicographically.
  return right.some((r) => left.some((l) => compare(l[0], r[1]) < 0 && compare(r[0], l[1]) < 0));
}

function parseVersion(v) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v).trim());
  if (!m) return null;
  return [
    Number(m[1]),
    m[2] === undefined ? null : Number(m[2]),
    m[3] === undefined ? null : Number(m[3]),
  ];
}

const ORIGIN = [0, 0, 0];
const UNBOUNDED = [Infinity, 0, 0];

function at(v, i) {
  return v[i] ?? 0;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (at(a, i) !== at(b, i)) return at(a, i) < at(b, i) ? -1 : 1;
  }
  return 0;
}

const maxV = (a, b) => (compare(a, b) >= 0 ? a : b);
const minV = (a, b) => (compare(a, b) <= 0 ? a : b);

/** Smallest version strictly greater than `v` — an exclusive upper bound. */
function nextUp(v) {
  if (v[1] === null) return [v[0] + 1, 0, 0];
  if (v[2] === null) return [v[0], v[1] + 1, 0];
  return [v[0], v[1], v[2] + 1];
}

/** Fill in an unspecified component with 0 so bounds compare numerically. */
function concrete(v) {
  return [at(v, 0), at(v, 1), at(v, 2)];
}

/** Exclusive upper bound of a `^` range. */
function caretUpper(target, wildcardMinor, wildcardPatch) {
  if (at(target, 0) !== 0) return [target[0] + 1, 0, 0];
  if (wildcardMinor) return [1, 0, 0];
  if (wildcardPatch || at(target, 1) !== 0) return [0, at(target, 1) + 1, 0];
  return [0, at(target, 1), at(target, 2) + 1];
}

/**
 * Expand a version-or-range expression into `[lo, hi]` intervals.
 * @returns {[[number,number,number], [number,number,number]][] | null}
 *   `null` when the expression cannot be parsed.
 */
function expand(spec) {
  const text = String(spec).trim();
  if (!text || /^[xX*]$/.test(text)) return [[ORIGIN, UNBOUNDED]];

  const clauses = text.split("||").map((clause) => {
    let lo = ORIGIN;
    let hi = UNBOUNDED;

    for (const comparator of clause.trim().split(/\s+/).filter(Boolean)) {
      const m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(comparator);
      if (!m) return null;
      const op = m[1] ?? "=";
      const target = parseVersion(m[2]);
      if (!target) return null;

      const parts = m[2].trim().split(".");
      const wildcardMinor = parts.length === 1 || /^[xX*]$/.test(parts[1] ?? "");
      const wildcardPatch = parts.length < 3 || /^[xX*]$/.test(parts[2] ?? "");

      switch (op) {
        case ">":
          lo = maxV(lo, nextUp(concrete(target)));
          break;
        case ">=":
          lo = maxV(lo, lowerOf(target, wildcardMinor, wildcardPatch));
          break;
        case "<":
          hi = minV(hi, concrete(target));
          break;
        case "<=":
          hi = minV(hi, nextUp(concrete(target)));
          break;
        case "^":
          lo = maxV(lo, lowerOf(target, wildcardMinor, wildcardPatch));
          hi = minV(hi, caretUpper(target, wildcardMinor, wildcardPatch));
          break;
        case "~":
          lo = maxV(lo, lowerOf(target, wildcardMinor, wildcardPatch));
          hi = minV(
            hi,
            wildcardMinor ? [at(target, 0) + 1, 0, 0] : [at(target, 0), at(target, 1) + 1, 0],
          );
          break;
        default:
          // Bare or `=`-prefixed: exact when fully specified, a prefix range otherwise.
          if (wildcardMinor) {
            return [[at(target, 0), 0, 0], [at(target, 0) + 1, 0, 0]];
          }
          if (wildcardPatch) {
            return [
              [at(target, 0), at(target, 1), 0],
              [at(target, 0), at(target, 1) + 1, 0],
            ];
          }
          lo = maxV(lo, concrete(target));
          hi = minV(hi, nextUp(target));
      }
    }
    return [lo, hi];
  });

  return clauses.some((c) => c === null) ? null : clauses;
}

function lowerOf(target, wildcardMinor, wildcardPatch) {
  if (wildcardMinor) return [at(target, 0), 0, 0];
  if (wildcardPatch) return [at(target, 0), at(target, 1), 0];
  return target;
}

// ── 9. Dependency version agreement ─────────────────────────────────────────

/**
 * Generic form of the policy in `check-stellar-sdk-version.mjs`: every
 * workspace in `required` must declare `dep`, and they must all declare the
 * *same* version string.
 *
 * Scoping matters — the repository intentionally does not declare every tool
 * everywhere, and some tools legitimately differ by workspace kind. Pass the
 * group that must move in lockstep (`circuits/` declares no TypeScript; `app`
 * is a Vite app whose `vitest` major tracks its `vite` release). Workspaces
 * outside `required` that still declare `dep` are reported in `outOfGroup` for
 * diagnostics but never fail the check.
 *
 * @param {Record<string, {dependencies?: object, devDependencies?: object}>} manifests
 * @param {string} dep package name
 * @param {string[]} [required] workspaces that must declare `dep` in lockstep
 * @returns {{ ok: boolean, versions: Map<string,string>, missing: string[],
 *   distinct: string[], outOfGroup: Map<string,string> }}
 */
export function checkDependencyVersions(manifests, dep, required) {
  const declared = new Map();
  for (const [ws, pkg] of Object.entries(manifests)) {
    const range = pkg.dependencies?.[dep] ?? pkg.devDependencies?.[dep];
    if (range) declared.set(ws, range);
  }

  const group = required ?? [...declared.keys()];
  const versions = new Map(group.filter((ws) => declared.has(ws)).map((ws) => [ws, declared.get(ws)]));

  const missing = group.filter((ws) => !declared.has(ws));
  const outOfGroup = new Map([...declared].filter(([ws]) => !group.includes(ws)));
  const distinct = [...new Set(versions.values())];

  return { ok: missing.length === 0 && distinct.length <= 1, versions, missing, distinct, outOfGroup };
}

// ── 10. Relative Markdown links ────────────────────────────────────────────

/**
 * Matches inline Markdown links/images, capturing the target.
 * Reference-style definitions (`[x]: ./y`) are handled separately below.
 */
const INLINE_LINK = /!?\[[^\]]*\]\(\s*<?([^)>\s]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const REF_DEF = /^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm;

/** Targets that are never filesystem paths. */
function isExternalTarget(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target);
}

/**
 * Broken relative links in one Markdown file.
 *
 * Skips external schemes (`https:`, `mailto:`, …), protocol-relative URLs and
 * bare anchors; strips any `#fragment` / `?query`; and URL-decodes the path.
 *
 * @param {string} mdFile absolute path to the Markdown file
 * @param {string} source its contents
 * @returns {string[]} the raw link targets that do not resolve
 */
export function findBrokenLinks(mdFile, source) {
  const broken = [];
  const seen = new Set();

  const consider = (target) => {
    if (!target) return;
    if (isExternalTarget(target)) return;
    const pathOnly = target.split("#")[0].split("?")[0];
    if (!pathOnly) return;
    let decoded = pathOnly;
    try {
      decoded = decodeURIComponent(pathOnly);
    } catch {
      // Leave malformed percent-escapes as-is; the path is still checked.
    }
    if (!existsSync(resolve(dirname(mdFile), decoded))) {
      if (!seen.has(target)) {
        seen.add(target);
        broken.push(target);
      }
    }
  };

  for (const m of source.matchAll(INLINE_LINK)) consider(m[1]);
  for (const m of source.matchAll(REF_DEF)) consider(m[1]);

  return broken;
}
