import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AllergyAlertModal from "./AllergyAlertModal";

describe("AllergyAlertModal", () => {
  it("renders the scaffold header", () => {
    render(<AllergyAlertModal
      alerts={[{ kind: "allergy", severity: "warn", product: "Amoxicillin", ingredientId: "amoxicillin", customerId: "c1" }]}
      onAcknowledge={() => {}}
      onClose={() => {}}
    />);
    expect(screen.getAllByRole("heading").length).toBeGreaterThan(0);
  });

  it.skip("loads data from backing package once implemented", () => {
    // implemented per ADR
  });
});
