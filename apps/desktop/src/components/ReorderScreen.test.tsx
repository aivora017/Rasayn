// S26 Wave 2 Agent B — ReorderScreen hydrates from list_reorder_suggestions
// IPC. Replaces MOCK_STOCK / MOCK_SUPPLIERS / MOCK_FORECASTS arrays.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ToasterProvider } from "@pharmacare/design-system";
import { ReorderScreen } from "./ReorderScreen.js";
import {
  setIpcHandler,
  type IpcCall,
  type ReorderSuggestionDTO,
} from "../lib/ipc.js";

const SUGGESTIONS: readonly ReorderSuggestionDTO[] = [
  { productId: "p1", productName: "Insulin (NovoMix)", skuCode: "INS-N",
    supplierId: "sup2", supplierName: "Cipla Direct",
    onHandUnits: 2, expectedDemandUnits: 30, safetyStockUnits: 10,
    suggestQtyUnits: 40, suggestValuePaise: 18_00_000, urgency: "critical",
    daysOfStockLeft: 1 },
  { productId: "p2", productName: "Paracetamol 500mg", skuCode: "PCM500",
    supplierId: "sup1", supplierName: "Bharat Pharma",
    onHandUnits: 80, expectedDemandUnits: 100, safetyStockUnits: 50,
    suggestQtyUnits: 70, suggestValuePaise: 8_400, urgency: "normal",
    daysOfStockLeft: 8 },
];

function withIpc(args: { rows?: readonly ReorderSuggestionDTO[]; calls?: IpcCall[] }): void {
  setIpcHandler(async (call: IpcCall) => {
    args.calls?.push(call);
    if (call.cmd === "list_reorder_suggestions") return args.rows ?? [];
    return null;
  });
}

describe("ReorderScreen (S26 Wave 2 Agent B)", () => {
  beforeEach(() => {
    setIpcHandler(async () => null);
  });

  it("renders critical/high suggestions in the high-urgency (red) section", async () => {
    withIpc({ rows: SUGGESTIONS });
    render(
      <ToasterProvider>
        <ReorderScreen />
      </ToasterProvider>,
    );
    const highRow = await screen.findByTestId("reorder-row-p1");
    expect(highRow.getAttribute("data-urgency-band")).toBe("high");
    // High-urgency parent section is present and labelled.
    expect(screen.getByTestId("reorder-section-high")).toBeInTheDocument();
    expect(screen.getByTestId("reorder-section-high").textContent).toMatch(/High urgency/);
  });

  it("re-fires list_reorder_suggestions when the horizon slider changes", async () => {
    const calls: IpcCall[] = [];
    withIpc({ rows: SUGGESTIONS, calls });
    render(
      <ToasterProvider>
        <ReorderScreen shopId="shop_local" />
      </ToasterProvider>,
    );
    await waitFor(() => {
      expect(calls.some((c) => c.cmd === "list_reorder_suggestions")).toBe(true);
    });
    const first = calls.find((c) => c.cmd === "list_reorder_suggestions")!;
    expect(first.args).toMatchObject({ shopId: "shop_local", horizonDays: 14 });

    fireEvent.click(screen.getByTestId("reorder-horizon-preset-30"));
    await waitFor(() => {
      const last = [...calls].reverse().find((c) => c.cmd === "list_reorder_suggestions");
      expect(last?.args).toMatchObject({ shopId: "shop_local", horizonDays: 30 });
    });
  });

  it("shows the 'no reorders needed' empty state when IPC returns []", async () => {
    withIpc({ rows: [] });
    render(
      <ToasterProvider>
        <ReorderScreen />
      </ToasterProvider>,
    );
    expect(await screen.findByTestId("reorder-empty")).toBeInTheDocument();
    expect(screen.getByTestId("reorder-empty").textContent).toMatch(/No reorders needed/);
  });
});
