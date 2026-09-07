import { test } from "vitest";
import assert from "node:assert/strict";

import { formatXlm, xlmToStroops, STROOPS_PER_XLM } from "./amount.js";

test("xlmToStroops rounds the 1-stroop boundary exactly", () => {
  assert.equal(xlmToStroops("0.0000001"), 1n);
  assert.equal(xlmToStroops("0.00000009"), 0n);
});

test("formatXlm preserves the full i128::MAX boundary without losing precision", () => {
  const maxI128 = 170141183460469231731687303715884105727n;
  assert.equal(formatXlm(maxI128), "170141183460469231731687303715884105727.0000000");
  assert.equal(STROOPS_PER_XLM, 10_000_000n);
});

test("xlmToStroops and formatXlm handle negative values consistently", () => {
  assert.equal(xlmToStroops("-0.0000001"), -1n);
  assert.equal(formatXlm(-1n), "-0.0000001");
  assert.equal(formatXlm(-170141183460469231731687303715884105727n), "-170141183460469231731687303715884105727.0000000");
});
