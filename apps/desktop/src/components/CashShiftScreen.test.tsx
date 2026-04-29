import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CashShiftScreen from "./CashShiftScreen";

describe("CashShiftScreen", () => {
  it("renders the scaffold header", () => {
    render(<CashShiftScreen />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
