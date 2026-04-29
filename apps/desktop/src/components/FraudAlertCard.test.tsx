import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import FraudAlertCard from "./FraudAlertCard";

describe("FraudAlertCard", () => {
  it("renders the scaffold header", () => {
    render(<FraudAlertCard />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
