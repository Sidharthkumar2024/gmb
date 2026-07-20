"use client";

// Client-side i18n context (Claude Final Complete Architecture §9).
//
// Holds the active locale, exposes t() + dir + the enabled language list,
// persists the choice to localStorage, and reflects locale onto
// <html lang/dir> so RTL (Urdu/Arabic) flips the whole document. No URL
// locale routing — the app is client-rendered behind JWT auth, so a
// context keeps it simple and dependency-free. A later slice can seed the
// initial locale from the customer's saved language setting.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  LANGUAGES,
  directionOf,
  resolveLocale,
  type Direction,
  type LanguageDef,
} from "../lib/i18n/config";
import { dictFor, FALLBACK_DICT } from "../lib/i18n/messages";
import { translate } from "../lib/i18n/translate";

const STORAGE_KEY = "nexaflow.locale";
const DEFAULT_LANGUAGES = LANGUAGES.filter((l) => l.enabled);

export interface RuntimeLanguageInput {
  code: string;
  name?: string;
  nativeName?: string;
  direction?: "LTR" | "RTL" | "ltr" | "rtl";
}

export interface I18nContextValue {
  locale: string;
  dir: Direction;
  languages: readonly LanguageDef[];
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLocale: (code: string) => string;
  configureLanguages: (input: {
    languages?: RuntimeLanguageInput[];
    preferredLocale?: string;
  }) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: string;
}) {
  const [languages, setLanguages] = useState<LanguageDef[]>(DEFAULT_LANGUAGES);
  const enabledCodes = useMemo(
    () => new Set(languages.map((language) => language.code)),
    [languages],
  );
  const [locale, setLocaleState] = useState(() =>
    resolveLocale(initialLocale ?? DEFAULT_LOCALE, enabledCodes),
  );

  // Hydrate the saved preference after mount (avoids SSR/client mismatch).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setLocaleState(resolveLocale(saved, enabledCodes));
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, [enabledCodes]);

  const dirFor = useCallback(
    (code: string): Direction => {
      const normalized = code.toLowerCase();
      const base = normalized.split("-")[0];
      return (
        languages.find((language) => language.code === normalized)?.dir ??
        languages.find((language) => language.code === base)?.dir ??
        directionOf(code)
      );
    },
    [languages],
  );

  // Reflect locale onto the document for a11y + RTL layout.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
    document.documentElement.dir = dirFor(locale);
  }, [dirFor, locale]);

  const setLocale = useCallback((code: string) => {
    const next = resolveLocale(code, enabledCodes);
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore persistence failure */
    }
    return next;
  }, [enabledCodes]);

  const configureLanguages = useCallback(
    (input: { languages?: RuntimeLanguageInput[]; preferredLocale?: string }) => {
      const fromApi = (input.languages ?? [])
        .map<LanguageDef | null>((language) => {
          const code = language.code.trim().toLowerCase();
          if (!code) return null;
          return {
            code,
            label: language.name?.trim() || code.toUpperCase(),
            nativeName: language.nativeName?.trim() || language.name?.trim() || code.toUpperCase(),
            dir: language.direction?.toLowerCase() === "rtl" ? "rtl" : "ltr",
            enabled: true,
          };
        })
        .filter((language): language is LanguageDef => Boolean(language));
      const nextLanguages = fromApi.length ? fromApi : DEFAULT_LANGUAGES;
      const nextCodes = new Set(nextLanguages.map((language) => language.code));
      setLanguages(nextLanguages);
      setLocaleState((current) => {
        let requested = input.preferredLocale || current;
        try {
          const saved = window.localStorage.getItem(STORAGE_KEY);
          if (saved) requested = saved;
        } catch {
          /* ignore */
        }
        const next = resolveLocale(requested, nextCodes);
        try {
          window.localStorage.setItem(STORAGE_KEY, next);
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [],
  );

  const value = useMemo<I18nContextValue>(() => {
    const dict = dictFor(locale);
    return {
      locale,
      dir: dirFor(locale),
      languages,
      t: (key, vars) => translate(dict, key, vars, FALLBACK_DICT),
      setLocale,
      configureLanguages,
    };
  }, [configureLanguages, dirFor, languages, locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an <I18nProvider>.");
  }
  return ctx;
}
