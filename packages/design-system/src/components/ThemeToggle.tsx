import { useTheme } from "../theme/ThemeProvider.js";
import { IconButton } from "./IconButton.js";

/**
 * Cycles theme: light → dark → system → light.
 * Uses simple inline SVG icons to avoid lucide-react in design-system.
 */

const Sun = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
  </svg>
);
const Moon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);
const SystemIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>
  </svg>
);

export function ThemeToggle(): JSX.Element {
  const { mode, setMode } = useTheme();
  const next = mode === "light" ? "dark" : mode === "dark" ? "system" : "light";
  const icon = mode === "light" ? Sun : mode === "dark" ? Moon : SystemIcon;
  const label = `Theme: ${mode}. Click to switch to ${next}.`;
  return (
    <IconButton
      size="sm"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={() => setMode(next)}
      data-testid="theme-toggle"
    >
      {icon}
    </IconButton>
  );
}
