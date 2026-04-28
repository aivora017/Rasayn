import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IconButton } from "./IconButton.js";

describe("IconButton", () => {
  it("requires aria-label and exposes it", () => {
    render(<IconButton aria-label="Close"><span>×</span></IconButton>);
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
  it("forwards onClick", async () => {
    const fn = vi.fn();
    render(<IconButton aria-label="x" onClick={fn}><span>i</span></IconButton>);
    await userEvent.click(screen.getByRole("button"));
    expect(fn).toHaveBeenCalled();
  });
  it("disabled blocks click", async () => {
    const fn = vi.fn();
    render(<IconButton aria-label="x" disabled onClick={fn}><span>i</span></IconButton>);
    await userEvent.click(screen.getByRole("button"));
    expect(fn).not.toHaveBeenCalled();
  });
});
