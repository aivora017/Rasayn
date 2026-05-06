/**
 * BillingClinicalGuard — S26.D Wave 2 Agent C IPC hydration tests.
 *
 * Verifies:
 *   1. Empty DDI table from IPC -> guard no-ops, no alerts shown.
 *   2. Real DDI pair from IPC + matching basket -> DDI alert modal renders.
 *   3. Customer allergy from IPC + matching ingredient -> AllergyAlertModal renders.
 *   4. Dose-range from IPC + qty exceeds adult_max -> dose alert renders.
 *   5. IPC error on list_ddi_pairs -> guard logs but does not break Bill flow
 *      (graceful degradation per Playbook section 12).
 *
 * Pattern follows BillingScreen.test.tsx setIpcHandler / IpcCall capture and
 * WORKING_PATTERNS.md section 12 for any future dynamic-import expansion.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { setIpcHandler, type IpcCall } from "../lib/ipc.js";
import BillingClinicalGuard, { type ClinicalBasketLine } from "./BillingClinicalGuard.js";

// Fixture basket with two interacting ingredients (warfarin + aspirin).
const BASKET: ClinicalBasketLine[] = [
  { productId: "p_warfarin", ingredientIds: ["warfarin"], productName: "Warfarin 5mg" },
  { productId: "p_aspirin", ingredientIds: ["aspirin"], productName: "Aspirin 75mg" },
];

const CUSTOMER = { id: "cust_1", ageYears: 45 };

function makeHandler(opts: {
  ddiPairs?: unknown[];
  allergies?: unknown[];
  doseRangeFor?: Record<string, unknown | null>;
  ddiThrows?: boolean;
  capture?: IpcCall[];
}) {
  return async (call: IpcCall): Promise<unknown> => {
    opts.capture?.push(call);
    if (call.cmd === "list_ddi_pairs") {
      if (opts.ddiThrows) throw new Error("boom: ipc list_ddi_pairs failed");
      return opts.ddiPairs ?? [];
    }
    if (call.cmd === "list_customer_allergies") {
      return opts.allergies ?? [];
    }
    if (call.cmd === "list_dose_ranges") {
      const pid = (call.args as { productId: string }).productId;
      if (opts.doseRangeFor && pid in opts.doseRangeFor) return opts.doseRangeFor[pid];
      return null;
    }
    // Permissive null for any other bootstrap calls (per WORKING_PATTERNS section 12).
    return null;
  };
}

describe("BillingClinicalGuard - S26.D IPC hydration", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleErrorSpy.mockRestore();
  });

  it("1. empty DDI table from IPC -> guard no-ops, no alerts shown", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(makeHandler({ ddiPairs: [], allergies: [], capture: calls }));

    const { container } = render(
      <BillingClinicalGuard basket={BASKET} customer={CUSTOMER} />,
    );

    // Wait for IPC fetch to settle.
    await waitFor(() => {
      expect(calls.some((c) => c.cmd === "list_ddi_pairs")).toBe(true);
    });

    // No alerts -> component renders null (no testid present).
    await waitFor(() => {
      expect(screen.queryByTestId("billing-clinical-guard")).toBeNull();
      expect(screen.queryByTestId("ddi-modal")).toBeNull();
    });
    expect(container.querySelector('[data-testid="alert-ddi"]')).toBeNull();
  });

  it("2. real DDI pair from IPC + matching basket -> DDI alert modal renders", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(
      makeHandler({
        // canonicalPair sorts a < b: aspirin < warfarin
        ddiPairs: [
          {
            ingredientA: "aspirin",
            ingredientB: "warfarin",
            severity: "warn",
            mechanism: "additive bleeding risk",
            clinicalEffect: "increased INR + bleeding",
          },
        ],
        capture: calls,
      }),
    );

    render(<BillingClinicalGuard basket={BASKET} customer={CUSTOMER} />);

    await waitFor(() => {
      expect(screen.getByTestId("ddi-modal")).toBeInTheDocument();
    });
    expect(screen.getByTestId("alert-ddi")).toBeInTheDocument();
  });

  it("3. customer allergy from IPC + matching ingredient -> allergy alert renders", async () => {
    setIpcHandler(
      makeHandler({
        ddiPairs: [],
        allergies: [
          { customerId: "cust_1", ingredientId: "aspirin", severity: "block" },
        ],
      }),
    );

    render(<BillingClinicalGuard basket={BASKET} customer={CUSTOMER} />);

    await waitFor(() => {
      expect(screen.getByTestId("ddi-modal")).toBeInTheDocument();
    });
    expect(screen.getByTestId("alert-allergy")).toBeInTheDocument();
  });

  it("4. dose-range from IPC + qty exceeds adult_max -> dose alert renders", async () => {
    setIpcHandler(
      makeHandler({
        ddiPairs: [],
        allergies: [],
        doseRangeFor: {
          p_warfarin: {
            ingredientId: "warfarin",
            ageMinYears: 18,
            ageMaxYears: 99,
            dailyMaxMg: 10,
            perDoseMaxMg: 10,
          },
          p_aspirin: null,
        },
      }),
    );

    // Provide an over-dose basket: warfarin perDoseMg=20 > limitMg=10 -> block alert.
    const overdoseBasket: ClinicalBasketLine[] = [
      { productId: "p_warfarin", ingredientIds: ["warfarin"], perDoseMg: 20, dailyMg: 20, productName: "Warfarin" },
    ];
    render(<BillingClinicalGuard basket={overdoseBasket} customer={CUSTOMER} />);

    await waitFor(() => {
      expect(screen.getByTestId("ddi-modal")).toBeInTheDocument();
    });
    expect(screen.getByTestId("alert-dose")).toBeInTheDocument();
  });

  it("5. IPC error on list_ddi_pairs -> guard logs but does not break Bill flow", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(makeHandler({ ddiThrows: true, capture: calls }));

    // Render must not throw.
    const { container } = render(
      <BillingClinicalGuard basket={BASKET} customer={CUSTOMER} />,
    );

    await waitFor(() => {
      expect(calls.some((c) => c.cmd === "list_ddi_pairs")).toBe(true);
    });

    // Allow microtasks for catch -> setState to settle.
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    // No DDI modal — engine no-ops on the empty fallback array.
    expect(screen.queryByTestId("ddi-modal")).toBeNull();
    // Container exists (Bill flow continues).
    expect(container).toBeDefined();
  });
});
