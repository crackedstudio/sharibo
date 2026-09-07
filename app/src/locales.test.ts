import { describe, it, expect } from "vitest";
import en from "./locales/en";
import es from "./locales/es";

describe("locale key parity", () => {
  const enKeys = Object.keys(en).sort();
  const esKeys = Object.keys(es).sort();

  it("en is the source of truth and es has every key en defines", () => {
    const missing = enKeys.filter((key) => !(key in es));
    expect(missing, "Keys present in en but missing in es").toEqual([]);
  });

  it("es has no extra keys that en lacks", () => {
    const extra = esKeys.filter((key) => !(key in en));
    expect(extra, "Keys present in es but not in en").toEqual([]);
  });
});
