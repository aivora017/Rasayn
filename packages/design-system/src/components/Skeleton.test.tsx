import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./Skeleton.js";

describe("Skeleton", () => {
  it("renders with role=status and aria-busy", () => {
    render(<Skeleton width={100} />);
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-busy", "true");
    expect(el).toHaveAttribute("aria-label", "Loading");
  });

  it("circle shape applies rounded-full", () => {
    const { container } = render(<Skeleton shape="circle" width={32} height={32} />);
    expect(container.firstChild).toHaveClass("rounded-full");
  });

  it("inline width/height applied", () => {
    render(<Skeleton width={200} height={24} data-testid="s" />);
    const el = screen.getByTestId("s");
    expect(el).toHaveStyle({ width: "200px", height: "24px" });
  });
});
