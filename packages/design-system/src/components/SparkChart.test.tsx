import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SparkArea, SparkLine, TrendChart } from "./SparkChart.js";

describe("SparkArea", () => {
  it("renders with role=img and aria-label", () => {
    const { getByRole } = render(<SparkArea data={[1, 2, 3]} ariaLabel="sales" />);
    expect(getByRole("img", { name: "sales" })).toBeInTheDocument();
  });
});

describe("SparkLine", () => {
  it("renders with role=img and aria-label", () => {
    const { getByRole } = render(<SparkLine data={[1, 2, 3]} ariaLabel="line" />);
    expect(getByRole("img", { name: "line" })).toBeInTheDocument();
  });
});

describe("TrendChart", () => {
  it("renders a chart container with aria-label", () => {
    const { getByRole } = render(
      <TrendChart
        data={[
          { x: "Mon", y: 10 },
          { x: "Tue", y: 12 },
        ]}
        ariaLabel="weekly"
      />,
    );
    expect(getByRole("img", { name: "weekly" })).toBeInTheDocument();
  });
});
