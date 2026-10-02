/**
 * debugBundle.ts — collect a reproducible debug snapshot suitable for pasting
 * into a GitHub issue.
 *
 * CONTRACT: no Stellar secret seed (S…, 56 chars) or identity private scalar
 * (identityNullifier / identitySecret field values) must ever appear in the
 * serialised bundle. Every field is explicitly allow-listed; a final regex
 * pass is the defence-in-depth backstop.
 *
 * Redaction split (see #503):
 * - Fields the build-time allow-list controls (network config, artifact
 *   hashes, timings, user agent) are trusted. If a secret pattern matches
 *   there, the allow-list itself is broken, so we THROW — the caller must
 *   know the build-time guarantee failed.
 * - Runtime-sourced fields (notably `lastError`, which can carry Stellar SDK
 *   error payloads and XDR dumps) are untrusted. There we REDACT the match
 *   with `[REDACTED]` and surface a visible warning, so the user can still
 *   report their bug instead of getting an exception.
 *
 * The output is formatted markdown — paste directly into a bug report body.
 */

import type { LoggedSdkEvent } from "./sdkEventLog";

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
  /** Recent SDK observability events (already detail-redacted by useSdkEvents). */
  recentEvents?: LoggedSdkEvent[];
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
  recentEvents: LoggedSdkEvent[];
  userAgent: string;
  /**
   * Non-fatal redaction warnings raised while building the bundle. Present
   * only when a runtime-sourced field matched a secret pattern and was
   * redacted in place (see #503).
   */
  redactionWarnings?: string[];
}

// ─── redaction ──────────────────────────────────────────────────────────────

/**
 * Patterns that must never appear in the serialised bundle.
 * Shared with `scripts/maintenance/check-secrets.mjs` via secret-patterns.mjs
 * so a regex fix lands in both consumers.
 *
 * - Stellar secret seeds: start with 'S', 56 base-32 chars.
 * - Identity scalars: 77-digit decimal bigints (field elements).
 */
// Imported, not just re-exported: `export { X } from "..."` does not create a
// local binding, so findLeakedSecret below would have referenced an undefined
// REDACT_PATTERNS and thrown on every call.
import { REDACT_PATTERNS } from "../../../scripts/maintenance/secret-patterns.mjs";

export { REDACT_PATTERNS };

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

/**
 * Replace every secret-pattern match in `value` with `[REDACTED]`.
 * Returns the redacted string and the patterns that fired (empty if clean).
 */
export function redactSecrets(value: string): {
  redacted: string;
  matched: RegExp[];
} {
  const matched: RegExp[] = [];
  let redacted = value;
  for (const pattern of REDACT_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(redacted)) {
      matched.push(pattern);
      pattern.lastIndex = 0;
      redacted = redacted.replace(pattern, "[REDACTED]");
    }
  }
  return { redacted, matched };
}

// ─── core builder ───────────────────────────────────────────────────────────

/**
 * Build a redacted debug bundle from explicit, allow-listed inputs.
 *
 * Trusted (allow-list-controlled) fields are scanned and THROW on a match —
 * a hit there means the build-time allow-list failed and the caller must
 * know. Runtime-sourced fields (notably `lastError`) are redacted in place
 * and reported via `redactionWarnings`, so the user can still file a report.
 */
export function buildDebugBundle(input: BundleInput): DebugBundle {
  const warnings: string[] = [];

  // Runtime-sourced field: redact rather than throw so the report survives.
  let lastError = input.lastError;
  if (lastError !== null) {
    const { redacted, matched } = redactSecrets(lastError);
    if (matched.length > 0) {
      lastError = redacted;
      for (const m of matched) {
        warnings.push(
          `[debugBundle] Redacted secret-like value in lastError (matched /${m.source}/).`,
        );
      }
    }
  }

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
    lastError,
    fundedCount: input.fundedCount,
    circleSize: input.circleSize,
    potStroops: input.pot.toString(),
    artifactHashes: { ...input.artifactHashes },
    timings: { ...input.timings },
    recentEvents: (input.recentEvents ?? []).map((e) => ({
      type: e.type,
      at: e.at,
      detail: e.detail ? { ...e.detail } : undefined,
    })),
    userAgent: input.userAgent,
  };

  if (warnings.length > 0) bundle.redactionWarnings = warnings;

  // Defence-in-depth: scan the entire serialised bundle before returning it.
  // A hit here means a trusted (allow-list-controlled) field leaked — the
  // build-time guarantee failed, so we throw rather than silently redact.
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

  const eventLines =
    bundle.recentEvents.length > 0
      ? bundle.recentEvents
          .map((e) => {
            const detail = e.detail
              ? " " +
                Object.entries(e.detail)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(" ")
              : "";
            return `  ${e.at} ${e.type}${detail}`;
          })
          .join("\n")
      : "  (none recorded)";

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
    bundle.lastError ? "```\n" + bundle.lastError + "\n```" : "_none_",
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
    "",
    "#### Recent SDK events",
    "```",
    eventLines,
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
    // Clipboard API unavailable or permission denied — return the markdown
    // so the caller can fall back to a manual copy prompt.
    return { ok: false, markdown, error: "Clipboard API unavailable" };
  }
}
