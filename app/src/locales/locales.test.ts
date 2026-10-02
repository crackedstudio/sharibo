/**
 * Locale DATA assertions.
 *
 * Belong here: key-set parity across locale files, empty-value checks,
 * interpolation placeholder consistency, and "no locale may carry a key
 * that en.ts lacks".
 *
 * Do NOT put I18nProvider / t() behaviour here — that lives in
 * `app/src/i18n.test.tsx`.
 */
import { describe, it, expect } from "vitest";

function loadAllLocales(): Record<string, Record<string, string>> {
  const localeModules = import.meta.glob<{ default: Record<string, string> }>("./!(*.test).ts", {
    eager: true,
  });

  const locales: Record<string, Record<string, string>> = {};
  for (const [path, mod] of Object.entries(localeModules)) {
    const match = path.match(/\.\/([a-zA-Z-]+)\.ts$/);
    if (!match) continue;
    if (match[1].endsWith(".test")) continue;
    locales[match[1]] = mod.default;
  }
  return locales;
}

function extractPlaceholders(template: string): Set<string> {
  const placeholders = new Set<string>();
  const regex = /\{([a-zA-Z0-9_]+)\}/g;
  let match;
  while ((match = regex.exec(template)) !== null) {
    placeholders.add(match[1]);
  }
  return placeholders;
}

function formatPlaceholders(placeholders: Set<string>): string {
  return placeholders.size === 0 ? "(none)" : Array.from(placeholders).sort().join(", ");
}

describe("locale data", () => {
  const locales = loadAllLocales();
  const localeNames = Object.keys(locales).sort();
  const englishLocale = locales["en"];

  it("should have English locale loaded", () => {
    expect(englishLocale).toBeDefined();
    expect(Object.keys(englishLocale).length).toBeGreaterThan(0);
  });

  it("every locale should have the same keys as English (both directions)", () => {
    const englishKeys = Object.keys(englishLocale).sort();
    const failures: string[] = [];

    for (const localeName of localeNames) {
      if (localeName === "en") continue;

      const locale = locales[localeName];
      const localeKeys = Object.keys(locale).sort();

      const missingKeys = englishKeys.filter((key) => !localeKeys.includes(key));
      const extraKeys = localeKeys.filter((key) => !englishKeys.includes(key));

      if (missingKeys.length > 0 || extraKeys.length > 0) {
        let message = `Locale "${localeName}" has key parity issues:\n`;
        if (missingKeys.length > 0) {
          message += `  Missing keys (in en.ts but not ${localeName}.ts): ${missingKeys.join(", ")}\n`;
        }
        if (extraKeys.length > 0) {
          message += `  Extra keys (in ${localeName}.ts but not en.ts): ${extraKeys.join(", ")}`;
        }
        failures.push(message);
      }
    }

    expect(failures).toEqual([]);
  });

  it("no locale should have empty string values", () => {
    const failures: string[] = [];

    for (const [localeName, locale] of Object.entries(locales)) {
      const emptyKeys: string[] = [];
      for (const [key, value] of Object.entries(locale)) {
        if (value === "") emptyKeys.push(key);
      }
      if (emptyKeys.length > 0) {
        failures.push(
          `Locale "${localeName}" has empty string values for: ${emptyKeys.join(", ")}`,
        );
      }
    }

    expect(failures).toEqual([]);
  });

  it("each locale should have the same placeholders as English for each shared key", () => {
    const englishKeys = Object.keys(englishLocale);
    const failures: string[] = [];

    for (const key of englishKeys) {
      const englishPlaceholders = extractPlaceholders(englishLocale[key]);

      for (const localeName of localeNames) {
        if (localeName === "en") continue;
        const localeTemplate = locales[localeName][key];
        if (localeTemplate === undefined) continue;

        const localePlaceholders = extractPlaceholders(localeTemplate);
        const missingPlaceholders = Array.from(englishPlaceholders).filter(
          (p) => !localePlaceholders.has(p),
        );
        const extraPlaceholders = Array.from(localePlaceholders).filter(
          (p) => !englishPlaceholders.has(p),
        );

        if (missingPlaceholders.length > 0 || extraPlaceholders.length > 0) {
          failures.push(
            `Key "${key}" in locale "${localeName}": expected {${formatPlaceholders(englishPlaceholders)}}, got {${formatPlaceholders(localePlaceholders)}}`,
          );
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
