import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StockTransferScreen from "./StockTransferScreen";

describe("StockTransferScreen", () => {
  it("renders the scaffold header", () => {
    render(<StockTransferScreen />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
