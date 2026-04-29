import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CFDDisplay from "./CFDDisplay";

describe("CFDDisplay", () => {
  it("renders the scaffold header", () => {
    render(<CFDDisplay />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
