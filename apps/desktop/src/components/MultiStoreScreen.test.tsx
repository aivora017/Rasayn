import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MultiStoreScreen from "./MultiStoreScreen";

describe("MultiStoreScreen", () => {
  it("renders the scaffold header", () => {
    render(<MultiStoreScreen />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
