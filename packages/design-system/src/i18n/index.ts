import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./en.js";
import { hi } from "./hi.js";
import { mr } from "./mr.js";

/**
 * i18next bootstrap. Owners pick a UI language; numbers always render via
 * en-IN regardless of UI language (NS §16: lakh/crore is the cultural standard).
 *
 * Devanagari content gets a 1.1x line-height multiplier via the .pc-devanagari
 * class — apps add the class on <html> when locale is hi/mr.
 */

export const SUPPORTED_LOCALES = ["en", "hi", "mr"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
  mr: "मराठी",
};

export function initI18n(defaultLocale: Locale = "en"): typeof i18n {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources: { en: { translation: en }, hi: { translation: hi }, mr: { translation: mr } },
      lng: defaultLocale,
      fallbackLng: "en",
      interpolation: { escapeValue: false },
    });
  }
  return i18n;
}

export { en, hi, mr };
