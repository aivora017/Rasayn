import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button.js";

describe("Button", () => {
  it("renders text content", () => {
    render(<Button>Save bill</Button>);
    expect(screen.getByRole("button", { name: "Save bill" })).toBeInTheDocument();
  });

  it("forwards click events", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click me</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables on loading and shows aria-busy", () => {
    render(<Button loading>Saving</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });

  it("does not fire onClick while disabled", async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders shortcut chip", () => {
    render(<Button shortcut="⌘S">Save</Button>);
    expect(screen.getByText("⌘S")).toBeInTheDocument();
  });

  it("type defaults to button (not submit) to avoid accidental form-submits", () => {
    render(<Button>Click</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("supports type=submit when explicitly requested", () => {
    render(<Button type="submit">Send</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("variant prop affects class output", () => {
    render(<Button variant="danger">Delete</Button>);
    const btn = screen.getByRole("button");
    // tokenized — danger uses pc-state-danger
    expect(btn.className).toMatch(/pc-state-danger/);
  });
});
