/**
 * Shared Stellar secret / sensitive-value patterns.
 *
 * Single source of truth for:
 * - `scripts/maintenance/check-secrets.mjs` (pre-commit guard)
 * - `app/src/lib/debugBundle.ts` (defence-in-depth redaction)
 *
 * Keep one definition so a regex fix lands in both places.
 * This module is plain ESM so both Node `.mjs` scripts and the Vite app
 * can import it without a build step.
 */

/** Stellar secret seed: S + 55 chars from base-32 alphabet [A-Z2-7] (56 total). */
export const STELLAR_SECRET_KEY_PATTERN = /\bS[A-Z2-7]{55}\b/g;

/**
 * Large decimal integer (≥77 digits) — field-element sized scalar
 * (identityNullifier / identitySecret). Used by the debug bundle redactor;
 * the pre-commit hook only scans for Stellar secret keys.
 */
export const FIELD_ELEMENT_SCALAR_PATTERN = /\b\d{77,}\b/g;

/** Patterns that must never appear in a debug bundle. */
export const REDACT_PATTERNS = [STELLAR_SECRET_KEY_PATTERN, FIELD_ELEMENT_SCALAR_PATTERN];

/** Pattern used by the pre-commit secret scanner (secret keys only). */
export const COMMIT_SECRET_PATTERNS = [STELLAR_SECRET_KEY_PATTERN];
