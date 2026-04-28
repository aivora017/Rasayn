import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sparkline } from "./Sparkline.js";

describe("Sparkline", () => {
  it("renders an SVG with role=img and aria-label", () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} ariaLabel="sales" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-label", "sales");
  });
  it("handles empty data", () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
  it("renders area path when filled (default)", () => {
    const { container } = render(<Sparkline data={[1, 2, 3, 2, 4]} />);
    const paths = container.querySelectorAll("svg path");
    expect(paths.length).toBe(2);
  });
});
