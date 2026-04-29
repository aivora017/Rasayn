import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CopilotPanel from "./CopilotPanel";

describe("CopilotPanel", () => {
  it("renders the scaffold header", () => {
    render(<CopilotPanel />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
