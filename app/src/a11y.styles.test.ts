/**
 * a11y.styles.test.ts — guards over the design tokens and media queries in
 * app/src/style.css (issues #108, #109, #306).
 *
 * These assert the *stylesheet*, not a rendered page, and that is deliberate:
 *
 *   - axe-core's colour-contrast rule needs real layout and real computed
 *     styles. jsdom implements almost no CSS cascade, so contrast coverage
 *     there is unreliable — a pair can be 1.03:1 in production and the jsdom
 *     run still comes back clean. Checking the token values directly is the
 *     guard that actually holds.
 *   - Parsing the file also survives the #507 stylesheet split: if the tokens
 *     move into tokens.css, the failure is "token not found here" with a
 *     message pointing at the new location, not a silently skipped rule.
 *
 * Standard: WCAG 2.1 AA (see CONTRIBUTING.md).
 *
 * KNOWN SHORTFALLS
 * ----------------
 * Writing this guard surfaced real contrast failures that #108's audit did
 * not fix. Rather than ship a permanently red suite or quietly drop the
 * offending pairs, each known failure is pinned with `it.fails`: the suite
 * stays green, the defect stays visible in review, and the moment someone
 * fixes the colour, that single `it.fails` turns red and tells them to
 * delete it. Do not add a new entry here to make a failing test go away —
 * the strict test below already covers every pair that is not listed.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const STYLE_CSS = path.join(__dirname, "style.css");
const css = fs.readFileSync(STYLE_CSS, "utf8");

// ── colour maths (WCAG 2.1 relative luminance + contrast ratio) ──────────────

type Rgb = { r: number; g: number; b: number };

function parseHex(hex: string): Rgb {
  const raw = hex.trim().replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`unsupported colour literal: "${hex}"`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** WCAG 2.1 §Relative luminance. */
function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 §Contrast ratio, 1–21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(parseHex(foreground));
  const b = relativeLuminance(parseHex(background));
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

// ── token extraction ─────────────────────────────────────────────────────────

/** Custom properties declared inside a single block. */
function tokensIn(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

/** The block body opening at the first `{` at or after `startIndex`, brace-matched. */
function blockAt(startIndex: number): string {
  const open = css.indexOf("{", startIndex);
  if (open === -1) throw new Error(`no block opened at offset ${startIndex}`);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error("unbalanced braces");
}

function mediaBlock(query: string): string | null {
  const re = new RegExp(`@media\\s*\\(\\s*${query.replace(/[()]/g, "\\$&")}\\s*\\)`);
  const m = re.exec(css);
  return m ? blockAt(m.index) : null;
}

const LIGHT = tokensIn(blockAt(css.indexOf(":root")));
const DARK_BLOCK = mediaBlock("prefers-color-scheme: dark");
/** Dark mode is a partial override, exactly as the cascade resolves it. */
const DARK: Record<string, string> = { ...LIGHT, ...(DARK_BLOCK ? tokensIn(DARK_BLOCK) : {}) };

// ── the pairings under test ──────────────────────────────────────────────────

type Pair = {
  theme: "light" | "dark";
  foreground: string;
  background: string;
  why: string;
};

const PAIRS: readonly Pair[] = [
  {
    theme: "light",
    foreground: "--ink",
    background: "--bg",
    why: "body copy on the page background",
  },
  { theme: "light", foreground: "--ink", background: "--card", why: "body copy on card surfaces" },
  {
    theme: "light",
    foreground: "--ink",
    background: "--surface",
    why: "body copy on raised surfaces",
  },
  {
    theme: "light",
    foreground: "--ink",
    background: "--surface-muted",
    why: "body copy on muted fills",
  },
  {
    theme: "light",
    foreground: "--ink",
    background: "--surface-elevated",
    why: "body copy on elevated fills",
  },
  {
    theme: "light",
    foreground: "--ink",
    background: "--surface-raised",
    why: "body copy on raised tiles",
  },
  {
    theme: "light",
    foreground: "--ink",
    background: "--surface-purple",
    why: "body copy on the purple tint",
  },
  {
    theme: "light",
    foreground: "--ink",
    background: "--surface-banner",
    why: "body copy inside banners",
  },
  { theme: "light", foreground: "--muted", background: "--card", why: "secondary copy on cards" },
  { theme: "light", foreground: "--muted", background: "--bg", why: "secondary copy on the page" },
  { theme: "light", foreground: "--faint", background: "--card", why: "tertiary copy on cards" },
  { theme: "light", foreground: "--faint", background: "--bg", why: "tertiary copy on the page" },
  {
    theme: "light",
    foreground: "--text-muted",
    background: "--card",
    why: "--text-muted on cards",
  },
  {
    theme: "light",
    foreground: "--text-muted",
    background: "--surface",
    why: "--text-muted on raised surfaces",
  },
  {
    theme: "light",
    foreground: "--text-subtle",
    background: "--card",
    why: "--text-subtle on cards",
  },
  {
    theme: "light",
    foreground: "--text-subtle",
    background: "--bg",
    why: "--text-subtle on the page",
  },
  {
    theme: "light",
    foreground: "--text-tertiary",
    background: "--card",
    why: "--text-tertiary on cards",
  },
  { theme: "light", foreground: "--danger", background: "--card", why: "error copy on cards" },
  { theme: "light", foreground: "--danger", background: "--bg", why: "error copy on the page" },
  // Accent fills keep dark text in BOTH themes (see the --on-accent comment in
  // style.css), so --on-accent is the foreground under test, not --ink.
  {
    theme: "light",
    foreground: "--on-accent",
    background: "--accent",
    why: "text on the yellow accent fill",
  },
  {
    theme: "light",
    foreground: "--on-accent",
    background: "--accent2",
    why: "text on the mint accent fill",
  },

  // ── dark theme ──
  { theme: "dark", foreground: "--ink", background: "--bg", why: "[dark] body copy on the page" },
  { theme: "dark", foreground: "--ink", background: "--card", why: "[dark] body copy on cards" },
  {
    theme: "dark",
    foreground: "--ink",
    background: "--surface",
    why: "[dark] body copy on raised surfaces",
  },
  {
    theme: "dark",
    foreground: "--ink",
    background: "--surface-muted",
    why: "[dark] body copy on muted fills",
  },
  {
    theme: "dark",
    foreground: "--ink",
    background: "--surface-elevated",
    why: "[dark] body copy on elevated fills",
  },
  {
    theme: "dark",
    foreground: "--ink",
    background: "--surface-raised",
    why: "[dark] body copy on raised tiles",
  },
  {
    theme: "dark",
    foreground: "--ink",
    background: "--surface-purple",
    why: "[dark] body copy on the purple tint",
  },
  {
    theme: "dark",
    foreground: "--ink",
    background: "--surface-banner",
    why: "[dark] body copy inside banners",
  },
  {
    theme: "dark",
    foreground: "--muted",
    background: "--card",
    why: "[dark] secondary copy on cards",
  },
  {
    theme: "dark",
    foreground: "--faint",
    background: "--card",
    why: "[dark] tertiary copy on cards",
  },
  {
    theme: "dark",
    foreground: "--danger-text",
    background: "--card",
    why: "[dark] error copy on cards",
  },
  {
    theme: "dark",
    foreground: "--text-muted",
    background: "--card",
    why: "[dark] --text-muted on cards",
  },
  {
    theme: "dark",
    foreground: "--text-muted",
    background: "--surface",
    why: "[dark] --text-muted on raised surfaces",
  },
  {
    theme: "dark",
    foreground: "--text-subtle",
    background: "--card",
    why: "[dark] --text-subtle on cards",
  },
  {
    theme: "dark",
    foreground: "--text-subtle",
    background: "--bg",
    why: "[dark] --text-subtle on the page",
  },
  {
    theme: "dark",
    foreground: "--text-tertiary",
    background: "--card",
    why: "[dark] --text-tertiary on cards",
  },
  {
    theme: "dark",
    foreground: "--on-accent",
    background: "--accent",
    why: "[dark] text on the yellow accent fill",
  },
  {
    theme: "dark",
    foreground: "--on-accent",
    background: "--accent2",
    why: "[dark] text on the mint accent fill",
  },
];

/** AA body-text threshold. Every pair above is body-size copy, so 3:1 (the
 *  large-text allowance) is deliberately NOT used to wave anything through. */
const AA_BODY = 4.5;

function paletteFor(theme: Pair["theme"]): Record<string, string> {
  return theme === "light" ? LIGHT : DARK;
}

/**
 * Pairs confirmed below AA when this guard was written. Keyed by
 * `theme:foreground/background`. Each is pinned by an `it.fails` below.
 */
const KNOWN_SHORTFALLS: ReadonlySet<string> = new Set([
  // Light theme, marginal: both just under 4.5:1.
  "light:--faint/--bg",
  "light:--danger/--bg",
  // Dark theme: the dark block overrides --ink/--bg/--card/--surface but not
  // these light-only surface + text tokens, so near-white chips stay behind
  // near-white text. Ratios of ~1.0:1 are effectively invisible copy.
  "dark:--ink/--surface-muted",
  "dark:--ink/--surface-elevated",
  "dark:--ink/--surface-raised",
  "dark:--ink/--surface-purple",
  "dark:--ink/--surface-banner",
  "dark:--text-muted/--card",
  "dark:--text-muted/--surface",
  "dark:--text-subtle/--card",
  "dark:--text-subtle/--bg",
  "dark:--text-tertiary/--card",
]);

const key = (p: Pair) => `${p.theme}:${p.foreground}/${p.background}`;

function ratioFor(pair: Pair): number {
  const tokens = paletteFor(pair.theme);
  const fg = tokens[pair.foreground];
  const bg = tokens[pair.background];
  if (fg === undefined) {
    throw new Error(
      `token ${pair.foreground} is not declared for the ${pair.theme} theme. If the ` +
        `tokens moved during the #507 stylesheet split, point this test at the new file.`,
    );
  }
  if (bg === undefined) {
    throw new Error(
      `token ${pair.background} is not declared for the ${pair.theme} theme. If the ` +
        `tokens moved during the #507 stylesheet split, point this test at the new file.`,
    );
  }
  return contrastRatio(fg, bg);
}

describe("colour contrast — WCAG 2.1 AA", () => {
  const unchecked = PAIRS.filter((p) => !KNOWN_SHORTFALLS.has(key(p)));

  it(`every unguarded text/background pair meets AA (${unchecked.length} pairs)`, () => {
    const failures: string[] = [];
    for (const pair of unchecked) {
      const ratio = ratioFor(pair);
      if (ratio < AA_BODY) {
        failures.push(
          `${pair.why}: ${pair.foreground} on ${pair.background} is ${ratio.toFixed(2)}:1, ` +
            `below ${AA_BODY}:1.`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it("pins every pair listed in KNOWN_SHORTFALLS", () => {
    // A pair added to the set but never pinned by an it.fails below would be
    // excluded from the strict test and enforced by nothing.
    const pinned = PAIRS.filter((p) => KNOWN_SHORTFALLS.has(key(p))).map(key);
    expect(pinned.length, "KNOWN_SHORTFALLS lists pairs that PAIRS does not define").toBe(
      KNOWN_SHORTFALLS.size,
    );
    for (const k of KNOWN_SHORTFALLS) {
      expect(pinned, `${k} is in KNOWN_SHORTFALLS but has no matching pair in PAIRS`).toContain(k);
    }
  });

  for (const pair of PAIRS.filter((p) => KNOWN_SHORTFALLS.has(key(p)))) {
    // The body asserts the pair *passes* AA, so it fails today because the
    // defect is real. `it.fails` turns that into a passing test, and the moment
    // someone fixes the colour this turns red and points at the entry to delete.
    it.fails(`KNOWN: ${pair.why} is still below AA`, () => {
      const ratio = ratioFor(pair);
      expect(
        ratio,
        `${pair.why} now measures ${ratio.toFixed(2)}:1, which meets AA. ` +
          `Delete "${key(pair)}" from KNOWN_SHORTFALLS in a11y.styles.test.ts.`,
      ).toBeGreaterThanOrEqual(AA_BODY);
    });
  }
});

// ── media-query guard (#109, #306) ──────────────────────────────────────────

describe("media queries", () => {
  it("honours prefers-reduced-motion by disabling animation and transition (#109)", () => {
    const block = mediaBlock("prefers-reduced-motion: reduce");
    expect(
      block,
      "style.css has no @media (prefers-reduced-motion: reduce) block — deleting it " +
        "silently re-enables motion for users who asked for it to stop.",
    ).not.toBeNull();
    expect(block).toMatch(/transition\s*:\s*none\s*!important/);
    expect(block).toMatch(/animation\s*:\s*none\s*!important/);
  });

  it("honours prefers-color-scheme with a dark theme (#306)", () => {
    expect(DARK_BLOCK, "style.css has no @media (prefers-color-scheme: dark) block").not.toBeNull();
    // The dark block must actually flip the palette, not merely exist.
    expect(DARK_BLOCK).toMatch(/color-scheme\s*:\s*dark/);
    expect(DARK_BLOCK).toMatch(/--bg\s*:/);
    expect(DARK_BLOCK).toMatch(/--ink\s*:/);
  });

  it("keeps --on-accent dark in the dark theme so the accent fills stay readable", () => {
    // The accent fills stay vivid in dark mode, so they keep dark text. If this
    // ever gets overridden here, the accent pair flips contrast and the strict
    // test above fails — this assertion exists to say why.
    expect(
      DARK_BLOCK,
      "--on-accent is overridden in the dark theme; accent fills keep dark text in " +
        "both themes, so overriding it flips --on-accent on --accent/--accent2.",
    ).not.toMatch(/--on-accent\s*:/);
  });
});

// ── focus visibility (#107) ─────────────────────────────────────────────────

describe("focus visibility", () => {
  it("defines a visible focus indicator", () => {
    // #107 promised a visible focus state. jsdom computes no styles, so this
    // asserts the rule exists rather than that it renders a given colour —
    // the same "assert the source, not the effect" approach as above.
    expect(css, "style.css defines no :focus-visible rule, so keyboard focus is invisible").toMatch(
      /:focus-visible/,
    );
  });

  it("never removes the focus indicator without replacing it", () => {
    const removals = [...css.matchAll(/(^|[;{\s])outline\s*:\s*(none|0)\s*[;!]/gi)].map((m) =>
      css.slice(Math.max(0, m.index - 70), m.index + 40).replace(/\s+/g, " "),
    );
    expect(
      removals,
      "style.css sets outline:none/0 — every occurrence needs a visible replacement",
    ).toEqual([]);
  });
});
