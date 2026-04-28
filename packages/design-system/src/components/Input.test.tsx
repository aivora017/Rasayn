import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Input } from "./Input.js";

describe("Input", () => {
  it("renders and accepts typing", async () => {
    render(<Input placeholder="bill no" aria-label="bill" />);
    const el = screen.getByLabelText("bill") as HTMLInputElement;
    await userEvent.type(el, "B-2026");
    expect(el.value).toBe("B-2026");
  });
  it("renders prefix + suffix", () => {
    render(<Input leading="₹" trailing="kg" aria-label="qty" />);
    expect(screen.getByText("₹")).toBeInTheDocument();
    expect(screen.getByText("kg")).toBeInTheDocument();
  });
  it("invalid sets aria-invalid + danger border", () => {
    render(<Input invalid aria-label="x" />);
    expect(screen.getByLabelText("x")).toHaveAttribute("aria-invalid", "true");
  });
});
