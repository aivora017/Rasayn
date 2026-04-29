import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import KhataScreen from "./KhataScreen";

describe("KhataScreen", () => {
  it("renders the scaffold header", () => {
    render(<KhataScreen />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
