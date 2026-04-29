import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DPDPConsentScreen from "./DPDPConsentScreen";

describe("DPDPConsentScreen", () => {
  it("renders the scaffold header", () => {
    render(<DPDPConsentScreen />);
    expect(screen.getByRole("heading")).toBeInTheDocument();
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
