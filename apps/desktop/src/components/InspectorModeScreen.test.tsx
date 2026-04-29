import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InspectorModeScreen from "./InspectorModeScreen";

describe("InspectorModeScreen", () => {
  it("renders the scaffold header", () => {
    render(<InspectorModeScreen />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
