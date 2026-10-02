import { InvalidInputError } from "./errors.js";

export const STROOPS_PER_XLM = 10_000_000n;

/** Largest non-negative i128 value (2^127 - 1). */
export const MAX_I128 = 170141183460469231731687303715884105727n;

/**
 * Convert an XLM amount to stroops (1 XLM = 10_000_000 stroops).
 *
 * Semantics (documented + tested):
 * - Accepts `bigint` (whole XLM), finite `number`, or decimal `string`.
 * - Numbers in exponent notation (e.g. `1e-7`) are expanded before parsing.
 * - Fractional digits beyond 7 are **truncated**, never rounded up.
 * - Throws `RangeError` for non-finite numbers, empty strings, and any
 *   value that is not a decimal literal after normalisation.
 */
export function xlmToStroops(xlm: number | bigint | string): bigint {
  if (typeof xlm === "bigint") {
    return xlm * STROOPS_PER_XLM;
  }

  let value: string;
  if (typeof xlm === "number") {
    if (!Number.isFinite(xlm)) {
      throw new RangeError(`Invalid XLM value: ${String(xlm)}`);
    }
    value = expandNumberToDecimalString(xlm);
  } else {
    value = xlm.trim();
  }

  if (value.length === 0) {
    throw new RangeError(`Invalid XLM value: ${String(xlm)}`);
  }

  if (/[eE]/.test(value)) {
    const asNumber = Number(value);
    if (!Number.isFinite(asNumber)) {
      throw new RangeError(`Invalid XLM value: ${String(xlm)}`);
    }
    value = expandNumberToDecimalString(asNumber);
  }

  if (!/^[+-]?\d+(\.\d+)?$/.test(value)) {
    throw new RangeError(`Invalid XLM value: ${String(xlm)}`);
  }

  const negative = value.startsWith("-");
  const [wholePart, fractionalPart = ""] = value.replace(/^[+-]/, "").split(".");

  const wholeUnits = BigInt(wholePart || "0");
  // Truncate — do not round — past the stroop boundary.
  const adjustedFraction = fractionalPart.padEnd(7, "0").slice(0, 7);
  const result = wholeUnits * STROOPS_PER_XLM + BigInt(adjustedFraction || "0");

  return negative ? -result : result;
}

/**
 * Expand a finite JS number to a plain decimal string without exponent
 * notation, preserving enough fractional digits for stroop truncation.
 */
export function expandNumberToDecimalString(n: number): string {
  if (Object.is(n, -0) || n === 0) return "0";
  if (Number.isInteger(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER) {
    return String(n);
  }
  const fixed = n.toFixed(20);
  if (!fixed.includes(".")) return fixed;
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  return trimmed || "0";
}

export function stroopsToXlm(stroops: bigint): bigint {
  return stroops / STROOPS_PER_XLM;
}

export function formatXlm(stroops: bigint): string {
  const negative = stroops < 0n;
  const absolute = negative ? -stroops : stroops;
  const whole = absolute / STROOPS_PER_XLM;
  const remainder = absolute % STROOPS_PER_XLM;
  const fraction = remainder.toString().padStart(7, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export type ContributionValidationCause =
  | "empty"
  | "not_a_number"
  | "not_positive"
  | "too_many_decimals"
  | "out_of_range"
  | "pot_overflow"
  | "unaffordable";

export class ContributionValidationError extends InvalidInputError {
  readonly causeCode: ContributionValidationCause;

  constructor(causeCode: ContributionValidationCause, message: string) {
    super(message);
    this.causeCode = causeCode;
  }
}

/** Default friendbot per-account XLM allotment on Stellar testnet. */
export const FRIENDBOT_ACCOUNT_XLM = 10_000n;

export interface ValidateContributionOptions {
  size: number;
  /** Per-account balance available for one `fund` call, in whole XLM. */
  maxAffordableXlm?: bigint;
}

/**
 * Validate a contribution amount *before* building a transaction.
 *
 * Mirrors the contract's `create_circle` guards (`contribution > 0`, and
 * `contribution * size` must fit in i128) plus demo constraints (≤ 7 decimal
 * places, within a sane range, and affordable under friendbot funding).
 */
export function validateContributionAmount(
  raw: string | number,
  options: ValidateContributionOptions,
): { stroops: bigint } {
  const size = options.size;
  const maxAffordableXlm = options.maxAffordableXlm ?? FRIENDBOT_ACCOUNT_XLM;

  const text = typeof raw === "number" ? expandNumberToDecimalString(raw) : String(raw).trim();

  if (text.length === 0) {
    throw new ContributionValidationError("empty", "Enter a contribution amount.");
  }

  // Count typed fractional digits before conversion.
  if (typeof raw === "string") {
    const typed = raw.trim();
    if (/[eE]/.test(typed)) {
      // scientific notation is allowed via xlmToStroops normalisation
    } else if (!/^[+-]?\d+(\.\d+)?$/.test(typed)) {
      throw new ContributionValidationError(
        "not_a_number",
        "Contribution must be a decimal number (e.g. 10 or 0.5).",
      );
    } else if (typed.includes(".")) {
      const typedFrac = typed.replace(/^[+-]/, "").split(".")[1] ?? "";
      if (typedFrac.length > 7) {
        throw new ContributionValidationError(
          "too_many_decimals",
          "Contribution supports at most 7 decimal places (1 stroop).",
        );
      }
    }
  }

  let stroops: bigint;
  try {
    stroops = xlmToStroops(typeof raw === "number" ? raw : text);
  } catch {
    throw new ContributionValidationError(
      "not_a_number",
      "Contribution must be a decimal number (e.g. 10 or 0.5).",
    );
  }

  if (stroops <= 0n) {
    throw new ContributionValidationError(
      "not_positive",
      "Contribution must be greater than zero.",
    );
  }

  if (size <= 0) {
    throw new ContributionValidationError("out_of_range", "Circle size must be greater than zero.");
  }

  // Mirror pot_target's checked multiply against i128.
  let pot: bigint;
  try {
    pot = stroops * BigInt(size);
  } catch {
    throw new ContributionValidationError(
      "pot_overflow",
      "Contribution × circle size overflows the on-chain i128 pot target.",
    );
  }
  if (pot > MAX_I128) {
    throw new ContributionValidationError(
      "pot_overflow",
      "Contribution × circle size overflows the on-chain i128 pot target.",
    );
  }

  const maxStroops = maxAffordableXlm * STROOPS_PER_XLM;
  if (stroops > maxStroops) {
    throw new ContributionValidationError(
      "unaffordable",
      `Friendbot funds only ~${maxAffordableXlm.toString()} XLM per account; choose a smaller contribution so every member can fund.`,
    );
  }

  // Extra absolute sanity rail (well above friendbot) for non-demo callers.
  const ABSURD_XLM = 1_000_000_000_000n; // 1e12 XLM
  if (stroops > ABSURD_XLM * STROOPS_PER_XLM) {
    throw new ContributionValidationError(
      "out_of_range",
      "Contribution is outside the supported range.",
    );
  }

  return { stroops };
}

/**
 * Locale-aware display formatting for XLM amounts shown in the UI.
 *
 * Uses `Intl.NumberFormat` with the active locale so Hindi gets lakh/crore
 * grouping and locales that use `,` as the decimal separator render correctly.
 *
 * **Do not use this for anything copied, compared, or persisted** — those
 * paths must keep {@link formatXlm}'s fixed ASCII `123.4567890` form so
 * wire formats and tests stay locale-independent.
 */
export function formatXlmDisplay(
  stroops: bigint,
  locale: string,
  options: Intl.NumberFormatOptions = {},
): string {
  const negative = stroops < 0n;
  const absolute = negative ? -stroops : stroops;
  const whole = absolute / STROOPS_PER_XLM;
  const remainder = absolute % STROOPS_PER_XLM;
  const asNumber = Number(whole) + Number(remainder) / 1e7;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 7,
    ...options,
  }).format(negative ? -asNumber : asNumber);
  return formatted;
}
