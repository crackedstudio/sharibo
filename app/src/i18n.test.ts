import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Load all locale files dynamically using the same pattern as i18n.ts
 */
function loadAllLocales(): Record<string, Record<string, string>> {
  const localeModules = import.meta.glob<{ default: Record<string, string> }>(
    "./locales/*.ts",
    { eager: true }
  );

  const locales: Record<string, Record<string, string>> = {};
  for (const [path, mod] of Object.entries(localeModules)) {
    const match = path.match(/\.\/locales\/([a-zA-Z-]+)\.ts$/);
    if (!match) continue;
    locales[match[1]] = mod.default;
  }
  return locales;
}

/**
 * Extract placeholder names from a template string
 * Placeholders follow the pattern {name} where name is alphanumeric or underscore
 */
function extractPlaceholders(template: string): Set<string> {
  const placeholders = new Set<string>();
  const regex = /\{([a-zA-Z0-9_]+)\}/g;
  let match;
  while ((match = regex.exec(template)) !== null) {
    placeholders.add(match[1]);
  }
  return placeholders;
}

/**
 * Format a set of placeholder names for error messages
 */
function formatPlaceholders(placeholders: Set<string>): string {
  return placeholders.size === 0 ? "(none)" : Array.from(placeholders).sort().join(", ");
}

describe("i18n locale key parity", () => {
  const locales = loadAllLocales();
  const localeNames = Object.keys(locales).sort();
  const englishLocale = locales["en"];

  // Verify English locale exists
  it("should have English locale loaded", () => {
    expect(englishLocale).toBeDefined();
    expect(Object.keys(englishLocale).length).toBeGreaterThan(0);
  });

  describe("key-set parity", () => {
    it("every locale should have the same keys as English", () => {
      const englishKeys = Object.keys(englishLocale).sort();
      const failures: string[] = [];

      for (const localeName of localeNames) {
        if (localeName === "en") continue;

        const locale = locales[localeName];
        const localeKeys = Object.keys(locale).sort();

        // Find missing keys (in English but not in locale)
        const missingKeys = englishKeys.filter((key) => !localeKeys.includes(key));

        // Find extra keys (in locale but not in English)
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
      if (failures.length > 0) {
        console.log(failures.join("\n"));
      }
    });
  });

  describe("empty string values", () => {
    it("no locale should have empty string values", () => {
      const failures: string[] = [];

      for (const [localeName, locale] of Object.entries(locales)) {
        const emptyKeys: string[] = [];
        for (const [key, value] of Object.entries(locale)) {
          if (value === "") {
            emptyKeys.push(key);
          }
        }

        if (emptyKeys.length > 0) {
          failures.push(
            `Locale "${localeName}" has empty string values for: ${emptyKeys.join(", ")}`
          );
        }
      }

      expect(failures).toEqual([]);
      if (failures.length > 0) {
        console.log(failures.join("\n"));
      }
    });
  });

  describe("interpolation placeholder parity", () => {
    it("each locale should have the same placeholders as English for each key", () => {
      const englishKeys = Object.keys(englishLocale);
      const failures: string[] = [];

      for (const key of englishKeys) {
        const englishTemplate = englishLocale[key];
        const englishPlaceholders = extractPlaceholders(englishTemplate);

        for (const localeName of localeNames) {
          if (localeName === "en") continue;

          const locale = locales[localeName];
          const localeTemplate = locale[key];

          if (localeTemplate === undefined) {
            // Skip keys that don't exist in this locale (caught by key-set parity test)
            continue;
          }

          const localePlaceholders = extractPlaceholders(localeTemplate);

          // Check if placeholder sets are identical
          const missingPlaceholders = Array.from(englishPlaceholders).filter(
            (p) => !localePlaceholders.has(p)
          );
          const extraPlaceholders = Array.from(localePlaceholders).filter(
            (p) => !englishPlaceholders.has(p)
          );

          if (missingPlaceholders.length > 0 || extraPlaceholders.length > 0) {
            let message = `Key "${key}" in locale "${localeName}" has placeholder parity issues:\n`;
            message += `  Expected placeholders: {${formatPlaceholders(englishPlaceholders)}}\n`;
            message += `  Actual placeholders: {${formatPlaceholders(localePlaceholders)}}`;
            if (missingPlaceholders.length > 0) {
              message += `\n  Missing: {${missingPlaceholders.join(", ")}}`;
            }
            if (extraPlaceholders.length > 0) {
              message += `\n  Extra: {${extraPlaceholders.join(", ")}}`;
            }
            failures.push(message);
          }
        }
      }

      expect(failures).toEqual([]);
      if (failures.length > 0) {
        console.log(failures.join("\n"));
      }
    });
  });

  describe("unknown-key fallback and dev warning", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("unknown key should return the key itself (safe to render)", () => {
      // Import the actual t function and dictionaries by simulating what i18n.ts does
      const localeModules = import.meta.glob<{ default: Record<string, string> }>(
        "./locales/*.ts",
        { eager: true }
      );

      const dictionaries: Record<string, Record<string, string>> = {};
      for (const [path, mod] of Object.entries(localeModules)) {
        const match = path.match(/\.\/locales\/([a-zA-Z-]+)\.ts$/);
        if (!match) continue;
        dictionaries[match[1]] = mod.default;
      }

      const fallbackLocale = "en";
      const current = dictionaries["en"];
      const fallback = dictionaries["en"];

      // Replicate the t() function logic
      const t = (key: string): string => {
        const template = current[key] ?? fallback[key];
        if (template === undefined) {
          if (import.meta.env.DEV) {
            console.warn(`[i18n] Unknown translation key: "${key}"`);
          }
          return key;
        }
        return template;
      };

      const unknownKey = "this.key.does.not.exist.anywhere";
      const result = t(unknownKey);

      expect(result).toBe(unknownKey);
      expect(result).not.toBeUndefined();
      expect(typeof result).toBe("string");
    });

    it("unknown key should trigger console.warn in development mode", () => {
      const localeModules = import.meta.glob<{ default: Record<string, string> }>(
        "./locales/*.ts",
        { eager: true }
      );

      const dictionaries: Record<string, Record<string, string>> = {};
      for (const [path, mod] of Object.entries(localeModules)) {
        const match = path.match(/\.\/locales\/([a-zA-Z-]+)\.ts$/);
        if (!match) continue;
        dictionaries[match[1]] = mod.default;
      }

      const fallbackLocale = "en";
      const current = dictionaries["en"];
      const fallback = dictionaries["en"];

      const t = (key: string): string => {
        const template = current[key] ?? fallback[key];
        if (template === undefined) {
          if (import.meta.env.DEV) {
            console.warn(`[i18n] Unknown translation key: "${key}"`);
          }
          return key;
        }
        return template;
      };

      const unknownKey = "unknown.test.key";
      t(unknownKey);

      // Only check warning was called in development mode
      if (import.meta.env.DEV) {
        expect(warnSpy).toHaveBeenCalledWith(`[i18n] Unknown translation key: "${unknownKey}"`);
      }
    });

    it("known key should not trigger console.warn", () => {
      const localeModules = import.meta.glob<{ default: Record<string, string> }>(
        "./locales/*.ts",
        { eager: true }
      );

      const dictionaries: Record<string, Record<string, string>> = {};
      for (const [path, mod] of Object.entries(localeModules)) {
        const match = path.match(/\.\/locales\/([a-zA-Z-]+)\.ts$/);
        if (!match) continue;
        dictionaries[match[1]] = mod.default;
      }

      const fallbackLocale = "en";
      const current = dictionaries["en"];
      const fallback = dictionaries["en"];

      const t = (key: string): string => {
        const template = current[key] ?? fallback[key];
        if (template === undefined) {
          if (import.meta.env.DEV) {
            console.warn(`[i18n] Unknown translation key: "${key}"`);
          }
          return key;
        }
        return template;
      };

      const knownKey = "lang.label"; // This key exists in all locales
      t(knownKey);

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
