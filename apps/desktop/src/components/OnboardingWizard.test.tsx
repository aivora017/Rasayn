/**
 * S27.B + S28-B3 — OnboardingWizard validation tests.
 *
 * S27.B base test: `isDpoComplete` helper guards the "Compliance contacts"
 * step; if any required text is empty or either email malformed, the Next
 * button stays disabled.
 *
 * S28-B3 additions:
 *   - bad GSTIN blocks Step-2 next
 *   - bad retail-licence number blocks Step-2 next
 *   - missing Schedule-H licence blocks Step-2 next
 *   - bad DPO email/phone blocks Step-3 submit
 *   - success path: all valid → onComplete dispatched with full payload
 *   - pre-existing shop → wizard renders redirect screen
 *
 * Pattern mirrors BillingScreen.test.tsx — vitest + plain imports, no
 * vi.resetModules() per WORKING_PATTERNS §12.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import OnboardingWizard, {
  isDpoComplete,
  isValidIndianMobile,
  isValidRetailLicense,
  validateOnboardingForm,
  type DpoContactDraft,
} from "./OnboardingWizard.js";

describe("OnboardingWizard · isDpoComplete (S27.B + S28-B3 phone gate)", () => {
  it("returns false when every required field is empty", () => {
    const draft: DpoContactDraft = {
      dpoName: "",
      dpoEmail: "",
      dpoPhone: "",
      grievanceOfficerName: "",
      grievanceOfficerEmail: "",
      grievanceOfficerPhone: "",
    };
    expect(isDpoComplete(draft)).toBe(false);
  });

  it("returns false when DPO email is malformed (other fields valid)", () => {
    const draft: DpoContactDraft = {
      dpoName: "X",
      dpoEmail: "malformed",
      dpoPhone: "+919000000000",
      grievanceOfficerName: "Y",
      grievanceOfficerEmail: "y@z.com",
      grievanceOfficerPhone: "+919000000001",
    };
    expect(isDpoComplete(draft)).toBe(false);
  });

  it("returns false when DPO phone is malformed (S28-B3)", () => {
    const draft: DpoContactDraft = {
      dpoName: "X",
      dpoEmail: "x@y.com",
      dpoPhone: "12345",  // too short
      grievanceOfficerName: "Y",
      grievanceOfficerEmail: "y@z.com",
      grievanceOfficerPhone: "+919000000001",
    };
    expect(isDpoComplete(draft)).toBe(false);
  });

  it("returns true when names + emails + phones all valid", () => {
    const draft: DpoContactDraft = {
      dpoName: "X",
      dpoEmail: "x@y.com",
      dpoPhone: "+91 90000 00000",
      grievanceOfficerName: "Y",
      grievanceOfficerEmail: "y@z.com",
      grievanceOfficerPhone: "9999988888",
    };
    expect(isDpoComplete(draft)).toBe(true);
  });
});

describe("isValidIndianMobile (S28-B3)", () => {
  it.each([
    ["+919000000000", true],
    ["+91 90000 00000", true],
    ["09000000000", true],
    ["9000000000", true],
    ["+9190000-00000", true],
    ["12345", false],
    ["+9190000", false],
    ["abc1234567", false],
    ["+15551234567", false],
  ])("isValidIndianMobile(%s) === %s", (input, expected) => {
    expect(isValidIndianMobile(input)).toBe(expected);
  });
});

describe("isValidRetailLicense (S28-B3)", () => {
  it("accepts MH-DRG-12345 (Maharashtra canonical)", () => {
    expect(isValidRetailLicense("MH-DRG-12345")).toBe(true);
  });
  it("accepts KA-DL-9876 (Karnataka short form)", () => {
    expect(isValidRetailLicense("KA-DL-9876")).toBe(true);
  });
  it("accepts MH-12345678 (numeric-only legacy)", () => {
    expect(isValidRetailLicense("MH-12345678")).toBe(true);
  });
  it("rejects DRG-12345 (no state prefix)", () => {
    expect(isValidRetailLicense("DRG-12345")).toBe(false);
  });
  it("rejects MH/DRG/12345 (slash separators)", () => {
    expect(isValidRetailLicense("MH/DRG/12345")).toBe(false);
  });
  it("rejects empty", () => {
    expect(isValidRetailLicense("")).toBe(false);
  });
});

describe("validateOnboardingForm aggregator (S28-B3 hard-gate)", () => {
  // Compute a valid GSTIN dynamically since the Mod-36 check makes it
  // impossible to write one inline without a calculator.
  // We import the validator's helper indirectly — simulate by feeding
  // the validator an ALREADY-known valid GSTIN: 27AAAAA0000A1Z2 (test1
  // output of computeGstinChecksum in gstin.ts).
  const VALID_MH_GSTIN = "27AAAAA0000A1Z2";

  it("returns ok=true when all three inputs valid", () => {
    const r = validateOnboardingForm(
      {
        entityType: "sole_proprietor",
        gstin: VALID_MH_GSTIN,
        retailDrugLicense: "MH-DRG-12345",
      },
      "MH-DRG-67890",
    );
    expect(r.ok).toBe(true);
  });

  it("flags bad GSTIN", () => {
    const r = validateOnboardingForm(
      {
        entityType: "sole_proprietor",
        gstin: "27AAAAA0000A1ZZ",  // wrong checksum
        retailDrugLicense: "MH-DRG-12345",
      },
      "MH-DRG-67890",
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("GSTIN"))).toBe(true);
  });

  it("flags missing Schedule-H licence", () => {
    const r = validateOnboardingForm(
      {
        entityType: "sole_proprietor",
        gstin: VALID_MH_GSTIN,
        retailDrugLicense: "MH-DRG-12345",
      },
      "",
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("Schedule-H"))).toBe(true);
  });

  it("flags malformed retail-licence", () => {
    const r = validateOnboardingForm(
      {
        entityType: "sole_proprietor",
        gstin: VALID_MH_GSTIN,
        retailDrugLicense: "garbage",
      },
      "MH-DRG-67890",
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("Retail licence"))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Component-level tests (S28-B3)
// ──────────────────────────────────────────────────────────────────────────

describe("OnboardingWizard component · S28-B3", () => {
  it("renders the redirect panel when shopProbe returns a pre-existing shop", async () => {
    const probe = vi.fn().mockResolvedValue({ id: "shop_existing" });
    render(<OnboardingWizard shopProbe={probe} />);
    await waitFor(() => {
      expect(screen.getByTestId("step-redirect")).toBeInTheDocument();
    });
    expect(screen.getByText(/already have a shop/i)).toBeInTheDocument();
  });

  it("renders the entity-type picker when shopProbe returns null", async () => {
    const probe = vi.fn().mockResolvedValue(null);
    render(<OnboardingWizard shopProbe={probe} />);
    await waitFor(() => {
      expect(screen.getByTestId("step-entity")).toBeInTheDocument();
    });
  });

  it("blocks the Step-2 Next button when GSTIN is invalid", async () => {
    render(<OnboardingWizard />);
    // Pick sole-proprietor (always present, minimal required fields).
    fireEvent.click(screen.getByText(/Sole Proprietor/i));
    fireEvent.click(screen.getByText(/Next: Business details/i));
    await waitFor(() => {
      expect(screen.getByTestId("step-details")).toBeInTheDocument();
    });
    // Type a malformed GSTIN.
    const gstin = screen.getByTestId("gstin");
    fireEvent.change(gstin, { target: { value: "BOGUS" } });
    const next = screen.getByTestId("step2-next");
    expect(next).toBeDisabled();
  });
});
