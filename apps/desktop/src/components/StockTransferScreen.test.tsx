import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StockTransferScreen from "./StockTransferScreen";

describe("StockTransferScreen", () => {
  it("renders the scaffold header", async () => {
    render(<StockTransferScreen />);
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
