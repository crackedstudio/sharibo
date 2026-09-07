/**
 * debugBundle.ts — collect a reproducible debug snapshot suitable for pasting
 * into a GitHub issue.
 *
 * CONTRACT: no Stellar secret seed (S…, 56 chars) or identity private scalar
 * (identityNullifier / identitySecret field values) must ever appear in the
 * serialised bundle. Every field is explicitly allow-listed; a final regex
 * pass is the defence-in-depth backstop.
 *
 * The output is formatted markdown — paste directly into a bug report body.
 */

// ─── types ──────────────────────────────────────────────────────────────────

export interface BundleNetworkConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  tokenContractId: string;
}

export interface BundleInput {
  /** Semantic version or git SHA injected at build time (VITE_APP_VERSION). */
  appVersion: string;
  network: BundleNetworkConfig;
  /** On-chain circle ID, null if no circle has been created yet. */
  circleId: bigint | null;
  /** Current on-chain round counter. */
  round: number;
  /** Current step label, e.g. "proving", "submitting". */
  currentStep: string | null;
  /** Last error message shown to the user (no stack trace). */
  lastError: string | null;
  /** Number of members who have funded this round. */
  fundedCount: number;
  /** Total circle size. */
  circleSize: number;
  /** Pot value in stroops (bigint). */
  pot: bigint;
  /**
   * Artifact hashes, e.g. { wasm: "sha256:…", zkey: "sha256:…" }.
   * Hash strings only — no raw binary content.
   */
  artifactHashes: Record<string, string>;
  /**
   * Step timings in ms, keyed by step name.
   * e.g. { artifacts: 1200, proving: 34500, submitting: 3100 }
   */
  timings: Record<string, number>;
  /** browser navigator.userAgent */
  userAgent: string;
}

export interface DebugBundle {
  /** ISO-8601 timestamp when the bundle was collected. */
  collectedAt: string;
  appVersion: string;
  network: BundleNetworkConfig;
  circleId: string | null;
  round: number;
  currentStep: string | null;
  lastError: string | null;
  fundedCount: number;
  circleSize: number;
  potStroops: string;
  artifactHashes: Record<string, string>;
  timings: Record<string, number>;
  userAgent: string;
}

// ─── redaction ──────────────────────────────────────────────────────────────

/**
 * Patterns that must never appear in the serialised bundle.
 *
 * - Stellar secret seeds: start with 'S', 56 base-32 chars.
 *   The Stellar SDK encodes secret keys as Strkey with version byte 0x90
 *   → always starts with 'S', always 56 chars, base-32 alphabet A-Z2-7.
 * - Identity scalars: 77-digit decimal bigints that represent field elements
 *   (identityNullifier / identitySecret from generateIdentity()). These are
 *   256-bit numbers, so ≥ 77 decimal digits long.
 *   (2^255 ≈ 5.8e76, so a field element is always ≥ 77 decimal digits.)
 */
export const REDACT_PATTERNS: RegExp[] = [
  // Stellar secret seed: S + 55 chars from base-32 alphabet [A-Z2-7]
  /S[A-Z2-7]{55}/g,
  // Large decimal integer (≥77 digits) — field-element sized scalar
  /\b\d{77,}\b/g,
];

/**
 * Scan a serialised bundle string for patterns that indicate a secret leaked.
 * Returns the first matching pattern, or null if clean.
 */
export function findLeakedSecret(serialised: string): RegExp | null {
  for (const pattern of REDACT_PATTERNS) {
    // Reset lastIndex — patterns are shared between calls.
    pattern.lastIndex = 0;
    if (pattern.test(serialised)) return pattern;
  }
  return null;
}

// ─── core builder ───────────────────────────────────────────────────────────

/**
 * Build a redacted debug bundle from explicit, allow-listed inputs.
 *
 * Throws if any value in the serialised bundle matches a secret pattern —
 * this is the hard guarantee: a bundle that would expose secret key material
 * is never returned to the caller.
 */
export function buildDebugBundle(input: BundleInput): DebugBundle {
  const bundle: DebugBundle = {
    collectedAt: new Date().toISOString(),
    appVersion: input.appVersion,
    network: {
      contractId: input.network.contractId,
      rpcUrl: input.network.rpcUrl,
      networkPassphrase: input.network.networkPassphrase,
      tokenContractId: input.network.tokenContractId,
    },
    // Bigints → plain strings for serialisation; we never include secret scalars.
    circleId: input.circleId !== null ? input.circleId.toString() : null,
    round: input.round,
    currentStep: input.currentStep,
    lastError: input.lastError,
    fundedCount: input.fundedCount,
    circleSize: input.circleSize,
    potStroops: input.pot.toString(),
    artifactHashes: { ...input.artifactHashes },
    timings: { ...input.timings },
    userAgent: input.userAgent,
  };

  // Defence-in-depth: scan the entire serialised bundle before returning it.
  // If anything pattern-matches a secret we throw rather than silently redact,
  // so the caller knows the build-time allow-list failed and can file a bug.
  const serialised = JSON.stringify(bundle);
  const leaked = findLeakedSecret(serialised);
  if (leaked) {
    throw new Error(
      `[debugBundle] Secret material leaked into bundle (matched /${leaked.source}/). ` +
        "This is a bug — please report it at https://github.com/crackedstudio/sharibo/issues",
    );
  }

  return bundle;
}

// ─── markdown formatter ─────────────────────────────────────────────────────

/**
 * Format a DebugBundle as a GitHub-flavoured markdown block, ready to paste
 * into a bug report body.
 */
export function formatBundleAsMarkdown(bundle: DebugBundle): string {
  const timingLines =
    Object.entries(bundle.timings).length > 0
      ? Object.entries(bundle.timings)
          .map(([k, ms]) => `  ${k}: ${ms}ms`)
          .join("\n")
      : "  (none recorded)";

  const artifactLines =
    Object.entries(bundle.artifactHashes).length > 0
      ? Object.entries(bundle.artifactHashes)
          .map(([k, h]) => `  ${k}: ${h}`)
          .join("\n")
      : "  (not loaded)";

  return [
    "### Sharibo debug bundle",
    "",
    `**Collected at:** ${bundle.collectedAt}`,
    `**App version:** ${bundle.appVersion}`,
    `**User agent:** ${bundle.userAgent}`,
    "",
    "#### Network",
    "```",
    `contract:   ${bundle.network.contractId}`,
    `token:      ${bundle.network.tokenContractId}`,
    `rpc:        ${bundle.network.rpcUrl}`,
    `passphrase: ${bundle.network.networkPassphrase}`,
    "```",
    "",
    "#### Circle state",
    "```",
    `circle id:    ${bundle.circleId ?? "(not created)"}`,
    `round:        ${bundle.round}`,
    `funded:       ${bundle.fundedCount} / ${bundle.circleSize}`,
    `pot (stroops): ${bundle.potStroops}`,
    `current step: ${bundle.currentStep ?? "(idle)"}`,
    "```",
    "",
    "#### Last error",
    bundle.lastError
      ? "```\n" + bundle.lastError + "\n```"
      : "_none_",
    "",
    "#### Artifact hashes",
    "```",
    artifactLines,
    "```",
    "",
    "#### Step timings",
    "```",
    timingLines,
    "```",
  ].join("\n");
}

// ─── clipboard helper ────────────────────────────────────────────────────────

/**
 * Build, format, and copy the debug bundle to the clipboard.
 *
 * Returns the formatted markdown string so the caller can show a preview or
 * fall back to a <textarea> prompt if the Clipboard API is unavailable.
 *
 * Never throws: errors are returned as `{ ok: false, error, markdown }` so
 * the UI can decide how to surface them.
 */
export async function copyDebugBundle(
  input: BundleInput,
): Promise<{ ok: boolean; markdown: string; error?: string }> {
  let markdown: string;
  try {
    const bundle = buildDebugBundle(input);
    markdown = formatBundleAsMarkdown(bundle);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, markdown: "", error: msg };
  }

  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(markdown);
    return { ok: true, markdown };
  } catch {
    // Return the markdown so the UI can fall back to prompt().
    return { ok: false, markdown, error: "Clipboard API unavailable" };
  }
}
