import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NumberFlip } from "./NumberFlip.js";

describe("NumberFlip", () => {
  it("exposes the canonical value to screen readers", () => {
    render(<NumberFlip value="₹47,820" />);
    expect(screen.getByLabelText("₹47,820")).toBeInTheDocument();
  });
  it("renders one digit cell per digit", () => {
    const { container } = render(<NumberFlip value="123" />);
    expect(container.querySelectorAll(".pc-numflip-digit").length).toBe(3);
  });
  it("non-digits render as plain spans", () => {
    const { container } = render(<NumberFlip value="$1.50" />);
    expect(container.querySelectorAll(".pc-numflip-digit").length).toBe(3); // 1, 5, 0
  });
});
