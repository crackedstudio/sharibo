import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { STROOPS_PER_XLM, formatXlm, stroopsToWholeXlm, xlmToStroops } from "./amount";

import {
  formatXlm,
  xlmToStroops,
  STROOPS_PER_XLM,
  validateContributionAmount,
  ContributionValidationError,
  FRIENDBOT_ACCOUNT_XLM,
  MAX_I128,
} from "./amount.js";

test("xlmToStroops truncates the 1-stroop boundary exactly (no round-up)", () => {
  assert.equal(xlmToStroops("0.0000001"), 1n);
  assert.equal(xlmToStroops("0.00000009"), 0n);
  assert.equal(xlmToStroops("0.00000015"), 1n); // truncates, does not round to 2
});

test("xlmToStroops accepts exponent-notation numbers below 1e-6", () => {
  assert.equal(xlmToStroops(1e-7), 1n);
  assert.equal(xlmToStroops("1e-7"), 1n);
  assert.equal(xlmToStroops(1e-8), 0n); // sub-stroop truncates to 0
});

test("round-trips through xlmToStroops", () => {
  const values = [0n, 1n, STROOPS_PER_XLM, 10_000_001n, 170141183460469231731687303715884105727n];
  for (const stroops of values) {
    assert.equal(xlmToStroops(formatXlm(stroops)), stroops);
  }
});

test("xlmToStroops and formatXlm handle negative values consistently", () => {
  assert.equal(xlmToStroops("-0.0000001"), -1n);
  assert.equal(formatXlm(-1n), "-0.0000001");
  assert.equal(
    formatXlm(-170141183460469231731687303715884105727n),
    "-170141183460469231731687303715884105727.0000000",
  );
});

function expectCause(raw: string | number, cause: string, size = 5) {
  assert.throws(
    () => validateContributionAmount(raw, { size }),
    (err: unknown) => err instanceof ContributionValidationError && err.causeCode === cause,
  );
}

test("validateContributionAmount rejects boundary values with distinct causes", () => {
  expectCause("0", "not_positive");
  expectCause("-1", "not_positive");
  expectCause("0.00000001", "too_many_decimals"); // 8 places
  expectCause("0.000000001", "too_many_decimals"); // sub-stroop typed as 9 places
  expectCause("", "empty");
  expectCause("abc", "not_a_number");
  // 20-digit whole XLM × size overflows or is unaffordable
  expectCause("12345678901234567890", "unaffordable");
});

test("validateContributionAmount accepts 1e-7 as one stroop", () => {
  const { stroops } = validateContributionAmount("1e-7", { size: 5 });
  assert.equal(stroops, 1n);
});

test("validateContributionAmount rejects pot overflow when × size exceeds i128", () => {
  const halfPlus = MAX_I128 / 2n + 1n;
  const xlm = formatXlm(halfPlus);
  const maxAffordableXlm = halfPlus / STROOPS_PER_XLM + 1n;
  assert.throws(
    () => validateContributionAmount(xlm, { size: 2, maxAffordableXlm }),
    (err: unknown) =>
      err instanceof ContributionValidationError && err.causeCode === "pot_overflow",
  );
});

test("validateContributionAmount accepts a normal demo amount", () => {
  const { stroops } = validateContributionAmount("10", { size: 5 });
  assert.equal(stroops, 10n * STROOPS_PER_XLM);
});

test("validateContributionAmount names unaffordable when above friendbot limit", () => {
  expectCause("10001", "unaffordable");
});

test("xlmToStroops(formatXlm(n)) round-trips for any non-negative stroop count", () => {
  fc.assert(
    fc.property(fc.bigInt({ min: 0n, max: 170141183460469231731687303715884105727n }), (n) => {
      assert.equal(xlmToStroops(formatXlm(n)), n);
    }),
  );
});
