import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./en.js";
import { hi } from "./hi.js";
import { mr } from "./mr.js";

/**
 * i18next bootstrap. Owners pick a UI language; numbers always render via
 * en-IN regardless of UI language (NS §16: lakh/crore is the cultural
 * standard).
 *
 * Default locale per Q-007: Marathi (Kalyan owner). Fallback chain
 * mr -> hi -> en. The fallback chain is critical: a missing Marathi key
 * falls back to Hindi (much closer in vocabulary than English) before
 * falling back to English. Missing keys log a one-time WARN (i18next
 * configured with `missingKeyHandler` below) and surface the dotted key
 * path in the UI so the missing entry is visible during pilot.
 *
 * Devanagari content gets a 1.1x line-height multiplier via the
 * `.pc-devanagari` class — apps add the class on <html> when locale
 * is hi/mr.
 */

export const SUPPORTED_LOCALES = ["en", "hi", "mr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
  mr: "मराठी",
};

export const DEFAULT_LOCALE: Locale = "mr";

const FALLBACK_CHAIN: Record<Locale, readonly Locale[]> = {
  // Per ADR-0074 §3 — mr falls to hi (closer than en for pharma vocab),
  // hi falls to en, en is terminal.
  mr: ["hi", "en"],
  hi: ["en"],
  en: [],
};

let _missingWarnedOnce = false;

export function initI18n(defaultLocale: Locale = DEFAULT_LOCALE): typeof i18n {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources: { en: { translation: en }, hi: { translation: hi }, mr: { translation: mr } },
      lng: defaultLocale,
      fallbackLng: (lng?: string): readonly string[] => {
        const l = (lng ?? defaultLocale) as Locale;
        return FALLBACK_CHAIN[l] ?? ["en"];
      },
      interpolation: { escapeValue: false },
      saveMissing: false,
      missingKeyHandler: (_lngs, _ns, key) => {
        if (!_missingWarnedOnce) {
          // eslint-disable-next-line no-console
          console.warn(`[i18n] missing key: ${key}`);
          _missingWarnedOnce = true;
        }
      },
    });
  }
  return i18n;
}

/** Switch the active UI locale. Persists to localStorage so the next
 *  app boot reuses the same locale. */
export function setLocale(loc: Locale): void {
  if (!SUPPORTED_LOCALES.includes(loc)) return;
  if (i18n.isInitialized) void i18n.changeLanguage(loc);
  try { localStorage.setItem("pc-locale", loc); } catch { /* SSR/no-DOM */ }
  // Devanagari class hint for line-height bump (NS §16).
  if (typeof document !== "undefined") {
    const html = document.documentElement;
    if (loc === "hi" || loc === "mr") html.classList.add("pc-devanagari");
    else html.classList.remove("pc-devanagari");
  }
}

export function getLocale(): Locale {
  if (i18n.isInitialized && SUPPORTED_LOCALES.includes(i18n.language as Locale)) {
    return i18n.language as Locale;
  }
  try {
    const stored = localStorage.getItem("pc-locale");
    if (stored && SUPPORTED_LOCALES.includes(stored as Locale)) return stored as Locale;
  } catch { /* SSR/no-DOM */ }
  return DEFAULT_LOCALE;
}

/**
 * Sync convenience wrapper around i18next's `t()` for non-React call
 * sites (e.g. the print template or unit tests). React components SHOULD
 * still prefer `useTranslation()` so re-render binding works.
 */
export function t(key: string, vars?: Readonly<Record<string, string | number>>): string {
  if (!i18n.isInitialized) initI18n();
  const out = vars === undefined ? i18n.t(key) : i18n.t(key, vars);
  return typeof out === "string" ? out : key;
}

export { en, hi, mr };
