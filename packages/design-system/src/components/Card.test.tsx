import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, CardKpi } from "./Card.js";

describe("Card", () => {
  it("renders children", () => {
    render(<Card>Hello</Card>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("renders as section when as=section", () => {
    render(<Card as="section" aria-label="kpis">x</Card>);
    expect(screen.getByLabelText("kpis").tagName).toBe("SECTION");
  });

  it("variant=brand uses brand-soft tint via tokens", () => {
    const { container } = render(<Card variant="brand">x</Card>);
    expect(container.firstChild).toHaveClass("bg-[var(--pc-brand-primary-soft)]");
  });
});

describe("CardKpi", () => {
  it("renders label, value, trend, sparkline", () => {
    render(
      <CardKpi
        label="Today"
        value="₹47,820"
        trend="+12%"
        sparkline={<svg data-testid="spark" />}
      />,
    );
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("₹47,820")).toBeInTheDocument();
    expect(screen.getByText("+12%")).toBeInTheDocument();
    expect(screen.getByTestId("spark")).toBeInTheDocument();
  });
});
