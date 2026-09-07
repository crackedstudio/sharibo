import { createContext, createElement, useContext, useMemo, useState, type ReactNode } from "react";

type Dictionary = Record<string, string>;

type LocaleModule = {
  default: Dictionary;
};

const localeModules = import.meta.glob<LocaleModule>("./locales/*.ts", { eager: true });

function loadDictionaries(): Record<string, Dictionary> {
  const out: Record<string, Dictionary> = {};
  for (const [path, mod] of Object.entries(localeModules)) {
    const match = path.match(/\.\/locales\/([a-zA-Z-]+)\.ts$/);
    if (!match) continue;
    out[match[1]] = mod.default;
  }
  return out;
}

const dictionaries = loadDictionaries();
const localeCodes = Object.keys(dictionaries);
const fallbackLocale = localeCodes.includes("en") ? "en" : localeCodes[0];

export type LocaleCode = string;

interface I18nContextValue {
  locale: LocaleCode;
  locales: LocaleCode[];
  setLocale: (next: LocaleCode) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

function chooseInitialLocale(): LocaleCode {
  try {
    const stored = localStorage.getItem("sharibo.locale");
    if (stored && dictionaries[stored]) return stored;
  } catch (e) {
    // Ignore localStorage errors (e.g., privacy modes)
  }

  const browser = navigator.language.toLowerCase();
  const exact = localeCodes.find((code) => code.toLowerCase() === browser);
  if (exact) return exact;

  const base = browser.split("-")[0];
  const baseMatch = localeCodes.find((code) => code.toLowerCase() === base);
  if (baseMatch) return baseMatch;

  return fallbackLocale;
}

function applyLocale(code: LocaleCode) {
  document.documentElement.lang = code;
  const rtlLocales = new Set(["ar", "he", "fa", "ur", "ps", "yi", "ug"]);
  document.documentElement.dir = rtlLocales.has(code.split("-")[0].toLowerCase()) ? "rtl" : "ltr";
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const value = vars[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(() => {
    const initial = chooseInitialLocale();
    applyLocale(initial);
    return initial;
  });

  const setLocale = (next: LocaleCode) => {
    if (!dictionaries[next]) return;
    setLocaleState(next);
    try {
      localStorage.setItem("sharibo.locale", next);
    } catch (e) {
      // Ignore localStorage errors
    }
    applyLocale(next);
  };

  const value = useMemo<I18nContextValue>(() => {
    const current = dictionaries[locale] ?? dictionaries[fallbackLocale];
    const fallback = dictionaries[fallbackLocale];

    const t = (key: string, vars?: Record<string, string | number>): string => {
      const template = current[key] ?? fallback[key];
      
      if (template === undefined) {
        // Warn in development when a key is not found in any locale
        if (import.meta.env.DEV) {
          console.warn(`[i18n] Unknown translation key: "${key}"`);
        }
        return key;
      }
      
      return interpolate(template, vars);
    };

    return {
      locale,
      locales: localeCodes,
      setLocale,
      t,
    };
  }, [locale]);

  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  const fallback = dictionaries[fallbackLocale] ?? {};
  const t = (key: string, vars?: Record<string, string | number>): string => {
    const template = fallback[key] ?? key;
    return interpolate(template, vars);
  };
  return {
    locale: fallbackLocale ?? "en",
    locales: localeCodes,
    setLocale: () => {},
    t,
  };
}

/**
 * Dropdown to switch the UI locale (en / es). Locale codes come from
 * whatever files exist under src/locales/, so adding a language is just
 * adding a dictionary file.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, locales, setLocale, t } = useI18n();
  return (
    <label className={className}>
      <span className="sr-only">{t("lang.label")}</span>
      <select
        aria-label={t("lang.label")}
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
      >
        {locales.map((code) => (
          <option key={code} value={code}>
            {t(`lang.${code}`)}
          </option>
        ))}
      </select>
    </label>
  );
}