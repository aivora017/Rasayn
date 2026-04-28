import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Light / dark theme provider.
 * North Star §1 law-7: light + dark are equal first-class.
 *
 * Mounts a `.dark` class on <html> when resolved theme is dark,
 * persists user preference in localStorage, and respects
 * `prefers-color-scheme` when mode is "system".
 *
 * Usage:
 *   <ThemeProvider defaultMode="system" storageKey="pc-theme">
 *     <App />
 *   </ThemeProvider>
 *
 *   const { mode, resolved, setMode } = useTheme();
 */

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  /** User's selected mode (incl. "system"). */
  mode: ThemeMode;
  /** Effective theme after resolving "system". */
  resolved: ResolvedTheme;
  /** Update preference (and persist). */
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  children: ReactNode;
  defaultMode?: ThemeMode;
  storageKey?: string;
  /** Element to receive the `.dark` class. Defaults to `document.documentElement`. */
  attributeTarget?: "html" | "body";
}

function resolveSystem(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStored(storageKey: string, fallback: ThemeMode): ThemeMode {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(storageKey);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* localStorage may be unavailable in private mode */
  }
  return fallback;
}

export function ThemeProvider({
  children,
  defaultMode = "system",
  storageKey = "pc-theme",
  attributeTarget = "html",
}: ThemeProviderProps): JSX.Element {
  const [mode, setModeState] = useState<ThemeMode>(() => readStored(storageKey, defaultMode));
  const [systemResolved, setSystemResolved] = useState<ResolvedTheme>(() => resolveSystem());

  // Listen to system preference changes when in "system" mode.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent): void =>
      setSystemResolved(e.matches ? "dark" : "light");
    if (mq.addEventListener) {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  const resolved: ResolvedTheme = mode === "system" ? systemResolved : mode;

  // Apply the .dark class on <html> (or <body>).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const target = attributeTarget === "body" ? document.body : document.documentElement;
    target.classList.toggle("dark", resolved === "dark");
  }, [resolved, attributeTarget]);

  const setMode = useCallback(
    (next: ThemeMode) => {
      setModeState(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode }),
    [mode, resolved, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}
