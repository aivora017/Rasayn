import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet.js";

describe("Sheet", () => {
  it("renders when open", () => {
    render(
      <Sheet open onClose={() => {}} ariaLabel="settings">
        body
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "settings" })).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });
  it("does not render content when closed", () => {
    render(
      <Sheet open={false} onClose={() => {}} ariaLabel="x">
        body
      </Sheet>,
    );
    expect(screen.queryByText("body")).not.toBeInTheDocument();
  });
  it("Esc fires onClose", async () => {
    const fn = vi.fn();
    render(
      <Sheet open onClose={fn} ariaLabel="x">
        body
      </Sheet>,
    );
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(fn).toHaveBeenCalled();
  });
  it("clicking overlay fires onClose", async () => {
    const fn = vi.fn();
    const { container } = render(
      <Sheet open onClose={fn} ariaLabel="x">
        body
      </Sheet>,
    );
    const overlay = container.querySelector('[aria-hidden="true"]');
    expect(overlay).not.toBeNull();
    if (overlay) await userEvent.click(overlay);
    expect(fn).toHaveBeenCalled();
  });
});
