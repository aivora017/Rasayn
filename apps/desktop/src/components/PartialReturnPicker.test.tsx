/**
 * A8 · PartialReturnPicker (ADR 0021).
 *
 * Covers:
 *  - modal closed ⇒ renders null (no dialog in DOM).
 *  - Enter in the bill-id input fires getBillFullRpc, populates refundable cells.
 *  - voided bill is rejected with an inline error.
 *  - F7 on a focused row sets return qty = refundable.
 *  - F6 opens the TenderReversalModal and its default seed respects ADR §2
 *    (single-tender mirror).
 *  - F9 fires save_partial_return with the correct input DTO, then onSaved.
 *  - Q5 concurrency — on QTY_EXCEEDS_REFUNDABLE, the picker refetches
 *    refundables, shows an amber banner, and marks over-qty rows red.
 *  - Esc calls onCancel while the picker is open.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { PartialReturnPicker } from "./PartialReturnPicker.js";
import {
  setIpcHandler,
  type IpcCall,
  type BillFullDTO,
  type BillLineFullDTO,
  type BillHeaderDTO,
  type ShopFullDTO,
  type PaymentRowDTO,
  type HsnSummaryDTO,
  type SavePartialReturnResultDTO,
} from "../lib/ipc.js";

const SHOP: ShopFullDTO = {
  id: "shop_jagannath_kalyan",
  name: "Jagannath Pharmacy",
  gstin: "27ABCDE1234F1Z5",
  stateCode: "27",
  retailLicense: "MH-KLY-RP-2024-0001",
  address: "Kalyan West, Maharashtra",
  pharmacistName: "Jagannath Shaw",
  pharmacistRegNo: "MSP/2019/0042",
  fssaiNo: null,
  defaultInvoiceLayout: "thermal_80mm",
};

const BILL_HEADER: BillHeaderDTO = {
  id: "bill_b1",
  billNo: "INV-001",
  billedAt: "2026-04-20T11:30:00+05:30",
  customerId: null,
  rxId: null,
  cashierId: "user_sourav_owner",
  gstTreatment: "intra",
  subtotalPaise: 30000,
  totalDiscountPaise: 0,
  totalCgstPaise: 1800,
  totalSgstPaise: 1800,
  totalIgstPaise: 0,
  totalCessPaise: 0,
  roundOffPaise: 0,
  grandTotalPaise: 33600,
  paymentMode: "cash",
  isVoided: 0,
};

function makeLine(overrides: Partial<BillLineFullDTO> & { id: string; qty: number }): BillLineFullDTO {
  return {
    productId: "p1",
    productName: "Paracetamol 500mg",
    hsn: "3004",
    batchId: "bt1",
    batchNo: "B01",
    expiryDate: "2027-12-31",
    mrpPaise: 15000,
    discountPct: 0,
    discountPaise: 0,
    taxableValuePaise: 10000,
    gstRate: 12,
    cgstPaise: 600,
    sgstPaise: 600,
    igstPaise: 0,
    cessPaise: 0,
    lineTotalPaise: 11200,
    schedule: "OTC",
    ...overrides,
  };
}

function makeBill(opts: {
  isVoided?: 0 | 1;
  lines?: readonly BillLineFullDTO[];
  payments?: readonly PaymentRowDTO[];
} = {}): BillFullDTO {
  const lines = opts.lines ?? [
    makeLine({ id: "l1", qty: 3 }),
    makeLine({ id: "l2", qty: 2, productName: "Cetirizine 10mg" }),
  ];
  const hsn: HsnSummaryDTO = {
    hsn: "3004", gstRate: 12,
    taxableValuePaise: 30000, cgstPaise: 1800, sgstPaise: 1800,
    igstPaise: 0, cessPaise: 0,
  };
  const payments: readonly PaymentRowDTO[] = opts.payments ?? [{
    id: "pay1", billId: BILL_HEADER.id, mode: "cash", amountPaise: 33600, refNo: null,
    createdAt: "2026-04-20T11:30:15+05:30",
  }];
  return {
    shop: SHOP,
    bill: { ...BILL_HEADER, isVoided: opts.isVoided ?? 0 },
    customer: null,
    prescription: null,
    lines,
    payments,
    hsnTaxSummary: [hsn],
  };
}

interface HandlerOpts {
  bill?: BillFullDTO;
  refundables?: Partial<Record<string, number>>;
  // Each call to refundables_return is pulled from this queue (first-wins);
  // if empty we fall back to `refundables` static map.
  refundableQueue?: number[];
  saveThrows?: string;
  saveResult?: SavePartialReturnResultDTO;
  nextReturnNoThrows?: string;
}

function installHandler(opts: HandlerOpts = {}): IpcCall[] {
  const calls: IpcCall[] = [];
  const bill = opts.bill ?? makeBill();
  const refundables = opts.refundables ?? { l1: 3, l2: 2 };
  const queue = [...(opts.refundableQueue ?? [])];
  const saveResult: SavePartialReturnResultDTO = opts.saveResult ?? {
    returnId: "ret_1",
    refundTotalPaise: 11200,
    einvoiceStatus: "pending",
    creditNoteIssuedId: "cn_1",
  };
  setIpcHandler(async (call) => {
    calls.push(call);
    switch (call.cmd) {
      case "get_bill_full":
        return bill;
      case "get_refundable_qty": {
        if (queue.length > 0) return queue.shift();
        return refundables[call.args.billLineId] ?? 0;
      }
      case "next_return_no":
        if (opts.nextReturnNoThrows) throw new Error(opts.nextReturnNoThrows);
        return "CRN/2026-27/0001";
      case "save_partial_return":
        if (opts.saveThrows) throw new Error(opts.saveThrows);
        return saveResult;
      default:
        return null;
    }
  });
  return calls;
}

describe("PartialReturnPicker · A8 step 7", () => {
  beforeEach(() => {
    setIpcHandler(async () => null);
  });

  it("open=false renders null", () => {
    const onSaved = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <PartialReturnPicker
        open={false}
        shopId="shop_jagannath_kalyan"
        actorUserId="user_sourav_owner"
        onSaved={onSaved}
        onCancel={onCancel}
      />,
    );
    expect(container.querySelector("[data-testid=\"partial-return-picker\"]")).toBeNull();
  });

  it("Enter loads bill + refundable qty per line", async () => {
    const calls = installHandler();
    render(
      <PartialReturnPicker
        open={true}
        shopId="shop_jagannath_kalyan"
        actorUserId="user_sourav_owner"
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const input = await screen.findByTestId("ret-picker-bill-id");
    fireEvent.change(input, { target: { value: "bill_b1" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByTestId("ret-picker-table")).toBeInTheDocument());
    // both rows + refundable columns rendered
    expect(screen.getByTestId("ret-picker-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("ret-picker-row-1")).toBeInTheDocument();
    // Bill lookup + 2 refundable probes
    expect(calls.filter((c) => c.cmd === "get_bill_full")).toHaveLength(1);
    expect(calls.filter((c) => c.cmd === "get_refundable_qty")).toHaveLength(2);
  });

  it("voided bill is rejected with inline error", async () => {
    installHandler({ bill: makeBill({ isVoided: 1 }) });
    render(
      <PartialReturnPicker
        open={true}
        shopId="shop_jagannath_kalyan"
        actorUserId="user_sourav_owner"
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("ret-picker-bill-id"), { target: { value: "bill_b1" } });
    fireEvent.click(screen.getByTestId("ret-picker-load"));
    const err = await screen.findByTestId("ret-picker-err");
    expect(err.textContent).toMatch(/voided/i);
    expect(screen.queryByTestId("ret-picker-table")).not.toBeInTheDocument();
  });

  it("F7 on focused row sets return qty = refundable", async () => {
    installHandler();
    render(
      <PartialReturnPicker
        open={true}
        shopId="shop_jagannath_kalyan"
        actorUserId="user_sourav_owner"
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("ret-picker-bill-id"), { target: { value: "bill_b1" } });
    fireEvent.keyDown(screen.getByTestId("ret-picker-bill-id"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("ret-picker-table")).toBeInTheDocument());

    // Focus first qty cell, then dispatch F7 on window.
    const qty0 = screen.getByTestId("ret-picker-qty-0") as HTMLInputElement;
    await act(async () => { qty0.focus(); });
    await act(async () => { fireEvent.keyDown(window, { key: "F7" }); });

    await waitFor(() =>
      expect((screen.getByTestId("ret-picker-qty-0") as HTMLInputElement).value).toBe("3"),
    );
  });

  it("F6 opens TenderReversalModal and the default seed is a single cash row", async () => {
    installHandler();
    render(
      <PartialReturnPicker
        open={true}
        shopId="shop_jagannath_kalyan"
        actorUserId="user_sourav_owner"
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("ret-picker-bill-id"), { target: { value: "bill_b1" } });
    fireEvent.keyDown(screen.getByTestId("ret-picker-bill-id"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("ret-picker-table")).toBeInTheDocument());

    // Set a qty so refundTotalPaise > 0 (required for F6 to open).
    fireEvent.change(screen.getByTestId("ret-picker-qty-0"), { target: { value: "1" } });

    fireEvent.keyDown(window, { key: "F6" });
    await waitFor(() => expect(screen.getByTestId("tender-reversal-modal")).toBeInTheDocument());
    // Single original payment was cash ⇒ seed mirrors to one cash row.
    const row0 = screen.getByTestId("tender-reversal-row-0");
    expect(row0).toBeInTheDocument();
    expect(row0.textContent).toContain("Cash");
    // Line 0 has qty=3 orig, taxable 10000, cgst+sgst 1200, so qty_returned=1
    // pro-rata = round(10000/3)+round(600/3)+round(600/3) = 3333+200+200 = 3733 paise = ₹37.33.
    expect(row0.textContent).toMatch(/37\.33/);
  });

  it("F9 saves when qty + tender plan set, fires onSaved with the result", async () => {
    const calls = installHandler();
    const onSaved = vi.fn();
    render(
      <PartialReturnPicker
        open={true}
        shopId="shop_jagannath_kalyan"
        actorUserId="user_sourav_owner"
        onSaved={onSaved}
        onCancel={vi.fn()}
        idFactory={() => "ret_1"}
      />,
    );
    fireEvent.change(screen.getByTestId("ret-picker-bill-id"), { target: { value: "bill_b1" } });
    fireEvent.keyDown(screen.getByTestId("ret-picker-bill-id"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("ret-picker-table")).toBeInTheDocument());

    // Return 1 unit of line 1.
    fireEvent.change(screen.getByTestId("ret-picker-qty-0"), { target: { value: "1" } });
    // Open + confirm default tender plan.
    fireEvent.keyDown(window, { key: "F6" });
    await waitFor(() => expect(screen.getByTestId("tender-reversal-modal")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tender-reversal-confirm"));
    await waitFor(() => expect(screen.queryByTestId("tender-reversal-modal")).not.toBeInTheDocument());

    fireEvent.keyDown(window, { key: "F9" });

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const saveCall = calls.find((c) => c.cmd === "save_partial_return");
    expect(saveCall).toBeTruthy();
    if (saveCall && saveCall.cmd === "save_partial_return") {
      expect(saveCall.args.input.returnId).toBe("ret_1");
      expect(saveCall.args.input.originalBillId).toBe("bill_b1");
      expect(saveCall.args.input.returnNo).toBe("CRN/2026-27/0001");
      expect(saveCall.args.input.lines).toHaveLength(1);
      expect(saveCall.args.input.lines[0]?.billLineId).toBe("l1");
      expect(saveCall.args.input.lines[0]?.qtyReturned).toBe(1);
      expect(saveCall.args.input.lines[0]?.reasonCode).toBe("wrong_sku");
      expect(saveCall.args.input.tenderPlan.length).toBeGreaterThan(0);
    }
  });

  it("Q5 concurrency: QTY_EXCEEDS_REFUNDABLE triggers refetch + red row + banner", async () => {
    // First two refundable probes return the originals (3, 2). After save
    // throws, refetch returns new refundables (0, 2) — row 0 should go red.
    const calls = installHandler({
      refundableQueue: [3, 2, 0, 2],
      saveThrows: "QTY_EXCEEDS_REFUNDABLE:l1",
    });
    render(
      <PartialReturnPicker
        open={true}
        shopId="shop_jagannath_kalyan"
        actorUserId="user_sourav_owner"
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        idFactory={() => "ret_1"}
      />,
    );
    fireEvent.change(screen.getByTestId("ret-picker-bill-id"), { target: { value: "bill_b1" } });
    fireEvent.keyDown(screen.getByTestId("ret-picker-bill-id"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("ret-picker-table")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("ret-picker-qty-0"), { target: { value: "1" } });

    // Open tender modal + confirm default plan.
    fireEvent.keyDown(window, { key: "F6" });
    await waitFor(() => expect(screen.getByTestId("tender-reversal-modal")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("tender-reversal-confirm"));

    // Attempt save.
    fireEvent.keyDown(window, { key: "F9" });

    // Amber banner + row 0 marked over-qty.
    await waitFor(() => expect(screen.getByTestId("ret-picker-concurrency")).toBeInTheDocument());
    await waitFor(() => {
      const row0 = screen.getByTestId("ret-picker-row-0");
      expect(row0.getAttribute("data-over-qty")).toBe("true");
    });
    // Total refundable probes: 2 initial + 2 refetch = 4.
    expect(calls.filter((c) => c.cmd === "get_refundable_qty").length).toBe(4);
  });

  it("Esc triggers onCancel", async () => {
    installHandler();
    const onCancel = vi.fn();
    render(
      <PartialReturnPicker
        open={true}
        shopId="shop_jagannath_kalyan"
        actorUserId="user_sourav_owner"
        onSaved={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await screen.findByTestId("ret-picker-bill-id");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Save disabled until tender plan set", async () => {
    installHandler();
    render(
      <PartialReturnPicker
        open={true}
        shopId="shop_jagannath_kalyan"
        actorUserId="user_sourav_owner"
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByTestId("ret-picker-bill-id"), { target: { value: "bill_b1" } });
    fireEvent.keyDown(screen.getByTestId("ret-picker-bill-id"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("ret-picker-table")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("ret-picker-qty-0"), { target: { value: "1" } });
    const saveBtn = screen.getByTestId("ret-picker-save") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });
});
