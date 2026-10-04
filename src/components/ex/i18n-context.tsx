"use client";

// Language preference, persisted like the theme (`em001-theme` in shell.tsx):
// localStorage key `em001-lang`, shared through an external store so every
// `useT()` consumer updates together, including across tabs.

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  isLocale,
  t as translate,
  type Locale,
  type MessageKey,
  type MessageVars,
} from "@/lib/i18n/messages";

export const LANG_KEY = "em001-lang";

const langListeners = new Set<() => void>();

function langSubscribe(cb: () => void): () => void {
  langListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    langListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function readStoredLocale(): Locale {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // ignore
  }
  return "en";
}

function langSnapshot(): Locale {
  return readStoredLocale();
}

function langServerSnapshot(): Locale {
  return "en";
}

export function applyDocumentLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "he" ? "rtl" : "ltr";
}

function writeLang(next: Locale): void {
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    // ignore
  }
  applyDocumentLocale(next);
  langListeners.forEach((cb) => cb());
}

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: MessageVars) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(langSubscribe, langSnapshot, langServerSnapshot);

  // The root layout's blocking script sets lang/dir before first paint.
  // Re-read storage here (not the server snapshot) so the hydration render,
  // which is still English, cannot paint over a stored Hebrew preference.
  useLayoutEffect(() => {
    applyDocumentLocale(readStoredLocale());
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    writeLang(next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useT must be used within I18nProvider");
  }
  return ctx;
}
