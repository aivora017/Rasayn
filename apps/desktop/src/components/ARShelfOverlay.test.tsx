import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ARShelfOverlay from "./ARShelfOverlay";

describe("ARShelfOverlay", () => {
  it("renders the scaffold header", () => {
    render(<ARShelfOverlay />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
