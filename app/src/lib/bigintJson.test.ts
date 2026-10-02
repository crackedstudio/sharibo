import { describe, expect, it } from "vitest";
import { parse, stringify } from "./bigintJson";

describe("bigintJson", () => {
  it("round-trips nested bigints, arrays, and null", () => {
    const value = {
      circleId: 42n,
      members: [1n, null, 2n],
      nested: { pot: 30_000_000n, note: null },
    };

    expect(parse(stringify(value))).toEqual(value);
  });

  it("round-trips a literal BIGINT:: string as a string", () => {
    const value = { label: "BIGINT::123", items: ["BIGINT::123", null, 7n] };

    const result = parse(stringify(value)) as {
      label: unknown;
      items: unknown[];
    };

    expect(result).toEqual(value);
    expect(typeof result.label).toBe("string");
    expect(typeof result.items[0]).toBe("string");
    expect(typeof result.items[2]).toBe("bigint");
  });
});
