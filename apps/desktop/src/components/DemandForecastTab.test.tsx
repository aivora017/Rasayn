import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DemandForecastTab from "./DemandForecastTab";

describe("DemandForecastTab", () => {
  it("renders the scaffold header", () => {
    render(<DemandForecastTab />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
