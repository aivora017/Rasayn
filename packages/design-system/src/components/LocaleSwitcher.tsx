import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from "../i18n/index.js";
import { cn } from "../utils/cn.js";

/**
 * Compact 3-way language toggle in the topbar. Persists choice in
 * localStorage. Adds .pc-devanagari class on <html> when hi/mr is active so
 * line-height multiplier kicks in.
 */

const STORAGE_KEY = "pc-locale";

export interface LocaleSwitcherProps {
  className?: string;
}

export function LocaleSwitcher({ className }: LocaleSwitcherProps): JSX.Element {
  const { i18n } = useTranslation();

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v && (SUPPORTED_LOCALES as readonly string[]).includes(v) && v !== i18n.language) {
        void i18n.changeLanguage(v);
      }
    } catch {/* noop */}
  }, [i18n]);

  useEffect(() => {
    document.documentElement.classList.toggle("pc-devanagari", i18n.language === "hi" || i18n.language === "mr");
  }, [i18n.language]);

  const onChoose = (loc: Locale): void => {
    void i18n.changeLanguage(loc);
    try { localStorage.setItem(STORAGE_KEY, loc); } catch {/* noop */}
  };

  return (
    <div className={cn("inline-flex items-center gap-0.5 rounded-[var(--pc-radius-md)] bg-[var(--pc-bg-surface-2)] p-0.5", className)}
      role="radiogroup" aria-label="Language">
      {SUPPORTED_LOCALES.map((loc) => (
        <button
          key={loc}
          type="button"
          role="radio"
          aria-checked={i18n.language === loc}
          onClick={() => onChoose(loc)}
          className={cn(
            "rounded-[var(--pc-radius-sm)] px-2 py-1 text-[11px] font-medium transition-colors",
            i18n.language === loc
              ? "bg-[var(--pc-bg-surface)] text-[var(--pc-text-primary)] shadow-[var(--pc-elevation-1)]"
              : "text-[var(--pc-text-secondary)] hover:text-[var(--pc-text-primary)]",
          )}
          data-testid={`locale-${loc}`}
        >
          {LOCALE_LABELS[loc]}
        </button>
      ))}
    </div>
  );
}
