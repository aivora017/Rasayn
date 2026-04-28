import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeProvider.js";

function Probe() {
  const { mode, resolved, setMode } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setMode("dark")}>dark</button>
      <button onClick={() => setMode("light")}>light</button>
      <button onClick={() => setMode("system")}>system</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    window.localStorage.clear();
  });

  it("defaults to system when no storage value", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("mode").textContent).toBe("system");
  });

  it("toggles .dark on <html> when mode=dark", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider defaultMode="light">
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await user.click(screen.getByRole("button", { name: "dark" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("persists preference to localStorage", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider storageKey="pc-test">
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "dark" }));
    expect(window.localStorage.getItem("pc-test")).toBe("dark");
  });

  it("rehydrates from storage on mount", () => {
    window.localStorage.setItem("pc-rehydrate", "dark");
    render(
      <ThemeProvider storageKey="pc-rehydrate">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("mode").textContent).toBe("dark");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("throws when useTheme is called outside provider", () => {
    const orig = console.error;
    console.error = vi.fn();
    expect(() => render(<Probe />)).toThrow(/useTheme/);
    console.error = orig;
  });
});
