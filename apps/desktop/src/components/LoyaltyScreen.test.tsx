import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LoyaltyScreen from "./LoyaltyScreen";

describe("LoyaltyScreen", () => {
  it("renders the scaffold header", () => {
    render(<LoyaltyScreen />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
