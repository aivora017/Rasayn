import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DDIAlertModal from "./DDIAlertModal";

describe("DDIAlertModal", () => {
  it("renders the scaffold header", () => {
    render(<DDIAlertModal
      alerts={[{ kind: "ddi", severity: "warn", productA: "Warfarin", productB: "Aspirin", ingredientA: "warfarin", ingredientB: "aspirin" }]}
      onAcknowledge={() => {}}
      onClose={() => {}}
    />);
    expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
