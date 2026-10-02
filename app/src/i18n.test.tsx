/**
 * I18n PROVIDER behaviour assertions.
 *
 * Belong here: t() lookup, missing-key fallback, interpolation, locale
 * switching, persistence (#298), document lang/dir, and call-site coverage
 * against en.ts.
 *
 * Do NOT put locale-file parity / empty-value / placeholder checks here —
 * those live in `app/src/locales/locales.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { I18nProvider, useI18n } from "./i18n";
import en from "./locales/en";

const localeModules = import.meta.glob<{ default: Record<string, string> }>(
  "./locales/*.ts",
  { eager: true },
);

function localeCodes(): string[] {
  return Object.keys(localeModules)
    .map((p) => p.match(/\.\/locales\/([a-zA-Z-]+)\.ts$/)?.[1])
    .filter((code): code is string => Boolean(code));
}

describe("i18n provider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = "";
    document.documentElement.dir = "";
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets initial lang and dir correctly", () => {
    localStorage.setItem("sharibo.locale", "en");

    function TestComponent() {
      const { locale } = useI18n();
      return <div data-testid="locale">{locale}</div>;
    }

    render(
      <I18nProvider>
        <TestComponent />
      </I18nProvider>,
    );

    expect(screen.getByTestId("locale").textContent).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("switches locale, updates lang/dir, and persists to localStorage", () => {
    function TestComponent() {
      const { locale, setLocale, t } = useI18n();
      return (
        <div>
          <div data-testid="locale">{locale}</div>
          <div data-testid="label">{t("lang.label")}</div>
          <button onClick={() => setLocale("es")} data-testid="switch">
            Switch to ES
          </button>
        </div>
      );
    }

    render(
      <I18nProvider>
        <TestComponent />
      </I18nProvider>,
    );

    act(() => {
      screen.getByTestId("switch").click();
    });

    expect(screen.getByTestId("locale").textContent).toBe("es");
    expect(document.documentElement.lang).toBe("es");
    expect(localStorage.getItem("sharibo.locale")).toBe("es");
    expect(screen.getByTestId("label").textContent).toBe("Idioma");
  });

  it("interpolates variables in t()", () => {
    function TestComponent() {
      const { t } = useI18n();
      return <div data-testid="msg">{t("fund.demoButton", { amount: 10 })}</div>;
    }

    render(
      <I18nProvider>
        <TestComponent />
      </I18nProvider>,
    );

    expect(screen.getByTestId("msg").textContent).toContain("10");
  });

  it("handles rtl locales correctly", () => {
    localStorage.setItem("sharibo.locale", "en");

    function TestComponent() {
      const { setLocale } = useI18n();
      return (
        <button onClick={() => setLocale("ar")} data-testid="switch-ar">
          Switch to AR
        </button>
      );
    }

    render(
      <I18nProvider>
        <TestComponent />
      </I18nProvider>,
    );

    expect(document.documentElement.dir).toBe("ltr");

    act(() => {
      screen.getByTestId("switch-ar").click();
    });

    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("unknown key returns the key itself (safe to render) and warns in DEV", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    function TestComponent() {
      const { t } = useI18n();
      return <div data-testid="missing">{t("this.key.does.not.exist.anywhere")}</div>;
    }

    render(
      <I18nProvider>
        <TestComponent />
      </I18nProvider>,
    );

    expect(screen.getByTestId("missing").textContent).toBe("this.key.does.not.exist.anywhere");
    if (import.meta.env.DEV) {
      expect(warnSpy).toHaveBeenCalledWith(
        '[i18n] Unknown translation key: "this.key.does.not.exist.anywhere"',
      );
    }
  });

  it("known key does not trigger console.warn", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    function TestComponent() {
      const { t } = useI18n();
      return <div>{t("lang.label")}</div>;
    }

    render(
      <I18nProvider>
        <TestComponent />
      </I18nProvider>,
    );

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not crash when localStorage throws", () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Access denied");
    });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Access denied");
    });

    function TestComponent() {
      const { locale, setLocale } = useI18n();
      return (
        <div>
          <div data-testid="locale">{locale}</div>
          <button onClick={() => setLocale("es")} data-testid="switch">
            Switch to ES
          </button>
        </div>
      );
    }

    expect(() => {
      render(
        <I18nProvider>
          <TestComponent />
        </I18nProvider>,
      );
    }).not.toThrow();

    expect(() => {
      act(() => {
        screen.getByTestId("switch").click();
      });
    }).not.toThrow();

    expect(screen.getByTestId("locale").textContent).toBe("es");
    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  it('every t("…") call site in app/src resolves to a key in en.ts', () => {
    const appSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
    const enKeys = new Set(Object.keys(en));
    const keyRe = /\bt\(\s*["'`]([^"'`]+)["'`]/g;
    const missing = new Map<string, string[]>();

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "locales" || entry.name.includes(".test.")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue;
        const source = fs.readFileSync(full, "utf8");
        let match;
        while ((match = keyRe.exec(source)) !== null) {
          const key = match[1];
          // Dynamic keys like `lang.${code}` are not literal call sites.
          if (key.includes("${") || key.includes("{")) continue;
          if (!enKeys.has(key)) {
            const rel = path.relative(appSrc, full);
            const list = missing.get(key) ?? [];
            list.push(rel);
            missing.set(key, list);
          }
        }
      }
    }

    walk(appSrc);

    expect(
      [...missing.entries()].map(([key, files]) => `${key} (${files.join(", ")})`),
    ).toEqual([]);
  });

  // No vitest-axe / axe-core dependency — lightweight smoke: each locale
  // dictionary can resolve landing keys without throwing.
  it("each locale dictionary renders landing copy without throwing", () => {
    localStorage.setItem("sharibo.locale", "en");

    function LandingSmoke() {
      const { t, locale, setLocale, locales } = useI18n();
      return (
        <div>
          <div data-testid="locale">{locale}</div>
          <p data-testid="tagline">{t("landing.tagline")}</p>
          <p data-testid="launch">{t("landing.launch")}</p>
          {locales.map((code) => (
            <button key={code} type="button" onClick={() => setLocale(code)} data-testid={`set-${code}`}>
              {code}
            </button>
          ))}
        </div>
      );
    }

    render(
      <I18nProvider>
        <LandingSmoke />
      </I18nProvider>,
    );

    for (const code of localeCodes()) {
      expect(() => {
        act(() => {
          screen.getByTestId(`set-${code}`).click();
        });
      }).not.toThrow();

      expect(screen.getByTestId("locale").textContent).toBe(code);
      expect(screen.getByTestId("tagline").textContent?.length).toBeGreaterThan(0);
      expect(screen.getByTestId("launch").textContent?.length).toBeGreaterThan(0);
    }
  });
});
