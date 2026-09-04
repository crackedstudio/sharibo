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
  const stored = localStorage.getItem("sharibo.locale");
  if (stored && dictionaries[stored]) return stored;

  const browser = navigator.language.toLowerCase();
  const exact = localeCodes.find((code) => code.toLowerCase() === browser);
  if (exact) return exact;

  const base = browser.split("-")[0];
  const baseMatch = localeCodes.find((code) => code.toLowerCase() === base);
  if (baseMatch) return baseMatch;

  return fallbackLocale;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const value = vars[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(() => chooseInitialLocale());

  const setLocale = (next: LocaleCode) => {
    if (!dictionaries[next]) return;
    setLocaleState(next);
    localStorage.setItem("sharibo.locale", next);
  };

  const value = useMemo<I18nContextValue>(() => {
    const current = dictionaries[locale] ?? dictionaries[fallbackLocale];
    const fallback = dictionaries[fallbackLocale];

    const t = (key: string, vars?: Record<string, string | number>): string => {
      const template = current[key] ?? fallback[key] ?? key;
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
