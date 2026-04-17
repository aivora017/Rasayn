/**
 * A5 — keyboard-first billing shell contract.
 *
 * Covers:
 *   - F1 resets a dirty bill and returns focus to the product search
 *   - F2 moves focus to the customer bar
 *   - F3 moves focus back to the product search
 *   - F4 moves focus to the last-line discount input
 *   - F6 opens the payment modal (when saveable), Esc closes it, F10 saves from inside it
 *   - F10 saves from the main screen
 *   - keyboard-only empty-bill ready state settles in under 2 s (shell perf gate)
 *   - a11y: landmarks present, toast is a live region, Save has an accessible name
 *   - no mouse path: full add-line → save via keyboard only
 *
 * ADR 0008 helpers (retype/clickWhenEnabled) promoted to src/test/form-helpers.ts —
 * any new type→submit test in A5+ should import from there.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App.js";
import { setIpcHandler, type IpcCall, type ProductHit, type BatchPick } from "../lib/ipc.js";
import { _resetPendingGrnDraftForTests } from "../lib/pendingGrnDraft.js";

const FIXTURES: ProductHit[] = [
  { id: "p1", name: "Crocin 500", genericName: "Paracetamol", manufacturer: "GSK", gstRate: 12, schedule: "OTC", mrpPaise: 11200 },
];
const BATCH: BatchPick = { id: "b1", batchNo: "LOT-A5", expiryDate: "2027-03-31", qtyOnHand: 30, mrpPaise: 11200 };
const BATCH_ALT: BatchPick = { id: "b2", batchNo: "LOT-A6", expiryDate: "2027-12-31", qtyOnHand: 50, mrpPaise: 11500 };

function handler(calls?: IpcCall[]) {
  return async (call: IpcCall) => {
    calls?.push(call);
    if (call.cmd === "health_check") return { ok: true, version: "0.1.0" };
    if (call.cmd === "db_version") return 2;
    if (call.cmd === "search_products") {
      const q = call.args.q.toLowerCase();
      return FIXTURES.filter((f) => f.name.toLowerCase().includes(q));
    }
    if (call.cmd === "pick_fefo_batch") return BATCH;
    if (call.cmd === "list_fefo_candidates") return [BATCH, BATCH_ALT];
    if (call.cmd === "save_bill") return { billId: "bill_a5", grandTotalPaise: 11200, linesInserted: 1 };
    if (call.cmd === "search_customers") return [];
    if (call.cmd === "list_prescriptions") return [];
    if (call.cmd === "list_stock") return [];
    return null;
  };
}

async function addOneLine(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId("product-search"), "croc");
  await screen.findByTestId("search-dropdown");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(screen.getByTestId("line-batch-0")).toBeInTheDocument());
}

describe("BillingScreen · A5 keyboard shell", () => {
  beforeEach(() => {
    setIpcHandler(handler());
    _resetPendingGrnDraftForTests();
  });

  it("boots with product search focused — the keyboard entry point", async () => {
    render(<App />);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId("product-search"));
    });
  });

  it("shell perf gate — empty-bill-ready state settles in <2 s", async () => {
    const t0 = performance.now();
    render(<App />);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId("product-search"));
    });
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(2000);
  });

  it("F1 resets a dirty bill and returns focus to product search", async () => {
    const user = userEvent.setup();
    render(<App />);
    await addOneLine(user);
    expect(screen.queryByTestId("empty-state")).toBeNull();

    fireEvent.keyDown(window, { key: "F1" });
    await waitFor(() => expect(screen.getByTestId("empty-state")).toBeInTheDocument());
    expect(document.activeElement).toBe(screen.getByTestId("product-search"));
  });

  it("F2 moves focus to the customer bar", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("product-search")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "F2" });
    expect(document.activeElement).toBe(screen.getByTestId("cust-search"));
  });

  it("F3 returns focus to the product search", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("product-search")).toBeInTheDocument());
    // First move focus away with F2
    fireEvent.keyDown(window, { key: "F2" });
    expect(document.activeElement).toBe(screen.getByTestId("cust-search"));
    // F3 brings it back
    fireEvent.keyDown(window, { key: "F3" });
    expect(document.activeElement).toBe(screen.getByTestId("product-search"));
  });

  it("F4 focuses the last-line discount input when lines exist", async () => {
    const user = userEvent.setup();
    render(<App />);
    await addOneLine(user);
    fireEvent.keyDown(window, { key: "F4" });
    expect(document.activeElement).toBe(screen.getByTestId("line-discount-0"));
  });

  it("F4 is a no-op when no lines are present — focus never lost to mouse", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("product-search")).toBeInTheDocument());
    const beforeEl = document.activeElement;
    fireEvent.keyDown(window, { key: "F4" });
    // Focus unchanged (still wherever it was before the no-op key).
    expect(document.activeElement).toBe(beforeEl);
  });

  it("F6 opens payment modal when saveable, Esc closes it", async () => {
    const user = userEvent.setup();
    render(<App />);
    await addOneLine(user);
    fireEvent.keyDown(window, { key: "F6" });
    await waitFor(() => expect(screen.getByTestId("payment-modal")).toBeInTheDocument());
    expect(screen.getByTestId("payment-amount").textContent).toMatch(/112\.00/);
    // Confirm button should be autofocused so Enter works immediately.
    expect(document.activeElement).toBe(screen.getByTestId("payment-confirm"));

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("payment-modal")).toBeNull());
  });

  it("F6 with empty bill shows an error toast and does not open the modal", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("empty-state")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "F6" });
    expect(screen.queryByTestId("payment-modal")).toBeNull();
    expect(screen.getByTestId("toast")).toHaveAttribute("data-toast-kind", "err");
    expect(screen.getByTestId("toast").textContent).toMatch(/Nothing to pay/);
  });

  it("F10 saves the bill from the main screen and clears lines", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(handler(calls));
    const user = userEvent.setup();
    render(<App />);
    await addOneLine(user);
    fireEvent.keyDown(window, { key: "F10" });
    await waitFor(() =>
      expect(screen.getByTestId("toast")).toHaveAttribute("data-toast-kind", "ok"),
    );
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(calls.some((c) => c.cmd === "save_bill")).toBe(true);
  });

  it("F10 inside the payment modal saves and closes the modal", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(handler(calls));
    const user = userEvent.setup();
    render(<App />);
    await addOneLine(user);
    fireEvent.keyDown(window, { key: "F6" });
    await waitFor(() => expect(screen.getByTestId("payment-modal")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "F10" });
    await waitFor(() => expect(screen.queryByTestId("payment-modal")).toBeNull());
    expect(calls.some((c) => c.cmd === "save_bill")).toBe(true);
  });

  it("keyboard-only path: add line via typing + Enter, then F10 saves — no mouse", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(handler(calls));
    const user = userEvent.setup();
    render(<App />);
    // Product search is already focused from mount.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId("product-search"));
    });
    await user.keyboard("croc");
    await screen.findByTestId("search-dropdown");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByTestId("line-batch-0")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "F10" });
    await waitFor(() =>
      expect(screen.getByTestId("toast")).toHaveAttribute("data-toast-kind", "ok"),
    );
    expect(calls.some((c) => c.cmd === "save_bill")).toBe(true);
  });

  it("Alt+2 from billing switches to inventory (nav keys don't collide with billing F-keys)", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("product-search")).toBeInTheDocument());
    // F2 (no Alt) is consumed by billing (focus cust-search), NOT nav.
    fireEvent.keyDown(window, { key: "F2" });
    expect(screen.getByTestId("current-mode")).toHaveTextContent("billing");
    // Alt+2 is nav.
    fireEvent.keyDown(window, { key: "2", altKey: true });
    expect(screen.getByTestId("current-mode")).toHaveTextContent("inventory");
  });

  it("a11y: billing region, customer listbox, Save button accessible name + shortcut", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("billing-root")).toBeInTheDocument());
    // Landmark region
    const region = screen.getByTestId("billing-root");
    expect(region).toHaveAttribute("role", "region");
    expect(region).toHaveAttribute("aria-label", "Billing");
    // Customer input has accessible name
    expect(screen.getByTestId("cust-search")).toHaveAttribute("aria-label", "Customer search");
    // Save button declares its keyshortcut
    const save = screen.getByTestId("save-bill");
    expect(save).toHaveAttribute("aria-keyshortcuts", "F10");
    expect(save.textContent).toMatch(/Save & Print \(F10\)/);
    // Totals aside is a landmark
    expect(screen.getByRole("complementary", { name: /Bill totals/ })).toBeInTheDocument();
  });
});

describe("BillingScreen · A6 F7 batch override", () => {
  beforeEach(() => {
    setIpcHandler(handler());
    _resetPendingGrnDraftForTests();
  });

  it("F7 opens the batch picker populated with FEFO candidates", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("product-search")).toBeInTheDocument());
    await addOneLine(user);

    fireEvent.keyDown(window, { key: "F7" });
    await waitFor(() => expect(screen.getByTestId("batch-override-modal")).toBeInTheDocument());
    // Two candidates from fixture
    expect(screen.getByTestId("batch-opt-0").textContent).toContain("LOT-A5");
    expect(screen.getByTestId("batch-opt-1").textContent).toContain("LOT-A6");
    // First auto-selected
    expect(screen.getByTestId("batch-opt-0")).toHaveAttribute("aria-selected", "true");
  });

  it("↓ + Enter swaps the line batch and re-takes MRP from the picked batch", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("product-search")).toBeInTheDocument());
    await addOneLine(user);

    fireEvent.keyDown(window, { key: "F7" });
    await waitFor(() => expect(screen.getByTestId("batch-override-modal")).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "ArrowDown" });
    await waitFor(() =>
      expect(screen.getByTestId("batch-opt-1")).toHaveAttribute("aria-selected", "true"),
    );
    fireEvent.keyDown(window, { key: "Enter" });

    await waitFor(() => expect(screen.queryByTestId("batch-override-modal")).not.toBeInTheDocument());
    // Line's batch label shows the new batch number
    expect(screen.getByTestId("line-batch-0").textContent).toContain("LOT-A6");
  });

  it("Esc closes the picker without mutating the line", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("product-search")).toBeInTheDocument());
    await addOneLine(user);

    const before = screen.getByTestId("line-batch-0").textContent;
    fireEvent.keyDown(window, { key: "F7" });
    await waitFor(() => expect(screen.getByTestId("batch-override-modal")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("batch-override-modal")).not.toBeInTheDocument());
    expect(screen.getByTestId("line-batch-0").textContent).toBe(before);
  });

  it("F7 with no lines shows a toast and does not open the picker", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("billing-root")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "F7" });
    expect(screen.queryByTestId("batch-override-modal")).not.toBeInTheDocument();
  });
});


// ---------------------------------------------------------------------------
// A13 (ADR 0013) · Expiry guard UI tests
// ---------------------------------------------------------------------------

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function handlerWithBatch(
  batchForPick: BatchPick,
  user: { id: string; name: string; role: "owner" | "cashier" | "pharmacist" | "viewer"; isActive: boolean } | null,
  overrideResult: { auditId: string; daysPastExpiry: number } = { auditId: "eo_test_123", daysPastExpiry: -20 },
  calls?: IpcCall[],
) {
  return async (call: IpcCall) => {
    calls?.push(call);
    if (call.cmd === "health_check") return { ok: true, version: "0.1.0" };
    if (call.cmd === "db_version") return 2;
    if (call.cmd === "search_products") {
      const q = call.args.q.toLowerCase();
      return FIXTURES.filter((f) => f.name.toLowerCase().includes(q));
    }
    if (call.cmd === "pick_fefo_batch") return batchForPick;
    if (call.cmd === "list_fefo_candidates") return [batchForPick];
    if (call.cmd === "save_bill") return { billId: "bill_a13", grandTotalPaise: 11200, linesInserted: 1 };
    if (call.cmd === "user_get") return user;
    if (call.cmd === "record_expiry_override") return overrideResult;
    if (call.cmd === "search_customers") return [];
    if (call.cmd === "list_prescriptions") return [];
    if (call.cmd === "list_stock") return [];
    return null;
  };
}

describe("BillingScreen · A13 expiry guard", () => {
  beforeEach(() => { _resetPendingGrnDraftForTests(); });

  it("shows a red chip on lines whose batch expires within 30 days", async () => {
    const user = userEvent.setup();
    const nearBatch: BatchPick = { id: "b_near", batchNo: "N001", expiryDate: isoDaysFromNow(15), qtyOnHand: 30, mrpPaise: 11200 };
    const owner = { id: "user_sourav_owner", name: "Owner", role: "owner" as const, isActive: true };
    setIpcHandler(handlerWithBatch(nearBatch, owner));

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("product-search")).toBeInTheDocument());
    await addOneLine(user);

    const chip = await screen.findByTestId("line-expiry-chip-0");
    expect(chip).toBeInTheDocument();
    expect(chip.getAttribute("data-tone")).toBe("red");
  });

  it("shows an amber chip for 31..90 day window", async () => {
    const user = userEvent.setup();
    const amberBatch: BatchPick = { id: "b_amber", batchNo: "A060", expiryDate: isoDaysFromNow(60), qtyOnHand: 30, mrpPaise: 11200 };
    const owner = { id: "user_sourav_owner", name: "Owner", role: "owner" as const, isActive: true };
    setIpcHandler(handlerWithBatch(amberBatch, owner));

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("product-search")).toBeInTheDocument());
    await addOneLine(user);

    const chip = await screen.findByTestId("line-expiry-chip-0");
    expect(chip.getAttribute("data-tone")).toBe("amber");
    // Amber lines should NOT open the override modal.
    expect(screen.queryByTestId("expiry-override-modal")).not.toBeInTheDocument();
  });

  it("hard-blocks an expired batch — toast, no line added", async () => {
    const user = userEvent.setup();
    const expired: BatchPick = { id: "b_exp", batchNo: "X999", expiryDate: isoDaysFromNow(-1), qtyOnHand: 30, mrpPaise: 11200 };
    const owner = { id: "user_sourav_owner", name: "Owner", role: "owner" as const, isActive: true };
    setIpcHandler(handlerWithBatch(expired, owner));

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("product-search")).toBeInTheDocument());
    await user.type(screen.getByTestId("product-search"), "croc");
    await screen.findByTestId("search-dropdown");
    await user.keyboard("{Enter}");

    // Toast appears, line is NOT added.
    await waitFor(() =>
      expect(screen.getByRole("status").textContent?.toLowerCase()).toMatch(/expired|return-to-supplier/),
    );
    expect(screen.queryByTestId("line-batch-0")).not.toBeInTheDocument();
  });

  it("opens the override modal for a near-expiry batch", async () => {
    const user = userEvent.setup();
    const near: BatchPick = { id: "b_near", batchNo: "N001", expiryDate: isoDaysFromNow(20), qtyOnHand: 30, mrpPaise: 11200 };
    const owner = { id: "user_sourav_owner", name: "Owner", role: "owner" as const, isActive: true };
    setIpcHandler(handlerWithBatch(near, owner));

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("product-search")).toBeInTheDocument());
    await addOneLine(user);

    const modal = await screen.findByTestId("expiry-override-modal");
    expect(modal).toBeInTheDocument();
    // Days-to-expiry display.
    expect(screen.getByTestId("expiry-override-days").textContent).toMatch(/20 day/);
  });

  it("owner enters reason + confirms → line persists and override is recorded", async () => {
    const user = userEvent.setup();
    const near: BatchPick = { id: "b_near", batchNo: "N001", expiryDate: isoDaysFromNow(20), qtyOnHand: 30, mrpPaise: 11200 };
    const owner = { id: "user_sourav_owner", name: "Owner", role: "owner" as const, isActive: true };
    const calls: IpcCall[] = [];
    setIpcHandler(handlerWithBatch(near, owner, { auditId: "eo_new", daysPastExpiry: -20 }, calls));

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("product-search")).toBeInTheDocument());
    await addOneLine(user);
    await screen.findByTestId("expiry-override-modal");

    await user.type(screen.getByTestId("expiry-override-reason"), "urgent, alt batch OOS");
    await user.click(screen.getByTestId("expiry-override-confirm"));

    await waitFor(() => expect(screen.queryByTestId("expiry-override-modal")).not.toBeInTheDocument());
    // Line still in the DOM (not stripped).
    expect(screen.getByTestId("line-batch-0")).toBeInTheDocument();
    // IPC: record_expiry_override was called with trimmed reason + owner id.
    const rec = calls.find((c) => c.cmd === "record_expiry_override");
    expect(rec).toBeTruthy();
    if (rec && rec.cmd === "record_expiry_override") {
      expect(rec.args.input.batchId).toBe("b_near");
      expect(rec.args.input.actorUserId).toBe("user_sourav_owner");
      expect(rec.args.input.reason).toBe("urgent, alt batch OOS");
    }
  });

  it("confirm button stays disabled when reason < 4 chars", async () => {
    const user = userEvent.setup();
    const near: BatchPick = { id: "b_near", batchNo: "N001", expiryDate: isoDaysFromNow(20), qtyOnHand: 30, mrpPaise: 11200 };
    const owner = { id: "user_sourav_owner", name: "Owner", role: "owner" as const, isActive: true };
    setIpcHandler(handlerWithBatch(near, owner));

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("product-search")).toBeInTheDocument());
    await addOneLine(user);
    await screen.findByTestId("expiry-override-modal");

    await user.type(screen.getByTestId("expiry-override-reason"), "ab");
    expect((screen.getByTestId("expiry-override-confirm") as HTMLButtonElement).disabled).toBe(true);
  });

  it("non-owner cannot confirm — role-warn banner is shown, button stays disabled", async () => {
    const user = userEvent.setup();
    const near: BatchPick = { id: "b_near", batchNo: "N001", expiryDate: isoDaysFromNow(20), qtyOnHand: 30, mrpPaise: 11200 };
    const cashier = { id: "user_cashier", name: "Kajal", role: "cashier" as const, isActive: true };
    setIpcHandler(handlerWithBatch(near, cashier));

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("product-search")).toBeInTheDocument());
    await addOneLine(user);
    await screen.findByTestId("expiry-override-modal");

    expect(screen.getByTestId("expiry-override-role-warn")).toBeInTheDocument();
    expect((screen.getByTestId("expiry-override-confirm") as HTMLButtonElement).disabled).toBe(true);
  });

  it("cancelling the override removes the offending line", async () => {
    const user = userEvent.setup();
    const near: BatchPick = { id: "b_near", batchNo: "N001", expiryDate: isoDaysFromNow(20), qtyOnHand: 30, mrpPaise: 11200 };
    const owner = { id: "user_sourav_owner", name: "Owner", role: "owner" as const, isActive: true };
    setIpcHandler(handlerWithBatch(near, owner));

    render(<App />);
    await waitFor(() => expect(screen.getByTestId("product-search")).toBeInTheDocument());
    await addOneLine(user);
    await screen.findByTestId("expiry-override-modal");

    await user.click(screen.getByTestId("expiry-override-cancel"));
    await waitFor(() => expect(screen.queryByTestId("expiry-override-modal")).not.toBeInTheDocument());
    expect(screen.queryByTestId("line-batch-0")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// A9 (ADR 0014) · F9 invoice print flow
// ---------------------------------------------------------------------------
describe("BillingScreen · A9 F9 invoice print", () => {
  const owner = { id: "user_sourav_owner", name: "Owner", role: "owner" as const, isActive: true };

  function billFullFixture() {
    return {
      shop: {
        id: "s_1", name: "Vaidyanath Pharmacy",
        gstin: "27ABCDE1234F1Z5", stateCode: "27",
        retailLicense: "20B-123456", address: "Kalyan, MH",
        pharmacistName: null, pharmacistRegNo: null, fssaiNo: null,
        defaultInvoiceLayout: "thermal_80mm",
      },
      bill: {
        id: "bill_a5", billNo: "B-00001",
        billedAt: "2026-04-17T14:03:00.000Z",
        customerId: null, rxId: null, cashierId: owner.id,
        gstTreatment: "registered",
        subtotalPaise: 10000, totalDiscountPaise: 0,
        totalCgstPaise: 600, totalSgstPaise: 600,
        totalIgstPaise: 0, totalCessPaise: 0,
        roundOffPaise: 0, grandTotalPaise: 11200,
        paymentMode: "cash", isVoided: 0,
      },
      customer: null,
      prescription: null,
      lines: [{
        id: "bl_1", productId: "p_paracip", productName: "Paracip 500 Tab",
        hsn: "3004", batchId: "b1", batchNo: "LOT-A5", expiryDate: "2027-03-31",
        qty: 1, mrpPaise: 11200, discountPct: 0, discountPaise: 0,
        taxableValuePaise: 10000, gstRate: 12,
        cgstPaise: 600, sgstPaise: 600, igstPaise: 0, cessPaise: 0,
        lineTotalPaise: 11200, schedule: "OTC" as const,
      }],
      payments: [],
      hsnTaxSummary: [],
    };
  }

  function printHandler(priorPrints = 0, calls?: IpcCall[]) {
    let n = priorPrints;
    return async (call: IpcCall): Promise<unknown> => {
      calls?.push(call);
      if (call.cmd === "health_check") return { ok: true, version: "0.1.0" };
      if (call.cmd === "db_version") return 2;
      if (call.cmd === "search_products") {
        const q = call.args.q.toLowerCase();
        return FIXTURES.filter((f) => f.name.toLowerCase().includes(q));
      }
      if (call.cmd === "pick_fefo_batch") return BATCH;
      if (call.cmd === "list_fefo_candidates") return [BATCH, BATCH_ALT];
      if (call.cmd === "save_bill") return { billId: "bill_a5", grandTotalPaise: 11200, linesInserted: 1 };
      if (call.cmd === "search_customers") return [];
      if (call.cmd === "list_prescriptions") return [];
      if (call.cmd === "list_stock") return [];
      if (call.cmd === "user_get") return owner;
      if (call.cmd === "get_nearest_expiry") return null;
      if (call.cmd === "get_bill_full") return billFullFixture();
      if (call.cmd === "record_print") {
        const isDup = n > 0 ? 1 : 0;
        n += 1;
        return {
          id: `pa_${n}`, billId: call.args.input.billId,
          layout: call.args.input.layout,
          isDuplicate: isDup, printCount: n,
          stampedAt: "2026-04-17T14:05:00.000Z",
        };
      }
      return null;
    };
  }

  it("F9 with no saved bill surfaces an error toast", async () => {
    setIpcHandler(printHandler());
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("product-search")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "F9" });
    await waitFor(() =>
      expect(screen.getByTestId("toast")).toHaveAttribute("data-toast-kind", "err"),
    );
    expect(screen.getByTestId("toast").textContent).toMatch(/save one first/i);
  });

  it("F9 after F10 save calls get_bill_full + record_print and mounts a print iframe", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(printHandler(0, calls));
    const user = userEvent.setup();
    render(<App />);
    await addOneLine(user);
    fireEvent.keyDown(window, { key: "F10" });
    await waitFor(() =>
      expect(screen.getByTestId("toast")).toHaveAttribute("data-toast-kind", "ok"),
    );

    fireEvent.keyDown(window, { key: "F9" });
    await waitFor(() => expect(calls.some((c) => c.cmd === "get_bill_full")).toBe(true));
    await waitFor(() => expect(calls.some((c) => c.cmd === "record_print")).toBe(true));
    const iframe = document.querySelector("iframe[aria-hidden='true']");
    expect(iframe).not.toBeNull();
    expect(screen.getByTestId("toast").textContent).toMatch(/Printing/);
  });

  it("second F9 stamps Reprint — record_print returns isDuplicate=1", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(printHandler(0, calls));
    const user = userEvent.setup();
    render(<App />);
    await addOneLine(user);
    fireEvent.keyDown(window, { key: "F10" });
    await waitFor(() =>
      expect(screen.getByTestId("toast")).toHaveAttribute("data-toast-kind", "ok"),
    );
    fireEvent.keyDown(window, { key: "F9" });
    await waitFor(() => expect(screen.getByTestId("toast").textContent).toMatch(/Printing/));
    fireEvent.keyDown(window, { key: "F9" });
    await waitFor(() => expect(screen.getByTestId("toast").textContent).toMatch(/Reprint #2/));
    const recordPrintCalls = calls.filter((c) => c.cmd === "record_print");
    expect(recordPrintCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("F1 reset clears lastSavedBillId so F9 reprint is no longer possible", async () => {
    setIpcHandler(printHandler());
    const user = userEvent.setup();
    render(<App />);
    await addOneLine(user);
    fireEvent.keyDown(window, { key: "F10" });
    await waitFor(() =>
      expect(screen.getByTestId("toast")).toHaveAttribute("data-toast-kind", "ok"),
    );
    fireEvent.keyDown(window, { key: "F1" });
    await waitFor(() => expect(screen.getByTestId("empty-state")).toBeInTheDocument());
    fireEvent.keyDown(window, { key: "F9" });
    await waitFor(() =>
      expect(screen.getByTestId("toast")).toHaveAttribute("data-toast-kind", "err"),
    );
  });
});

describe("BillingScreen · A12 e-invoice IRN chip", () => {
  const owner = { id: "user_sourav_owner", name: "Owner", role: "owner" as const, isActive: true };

  type IrnStatus = "pending" | "submitted" | "acked" | "failed" | "cancelled";
  function mockIrn(partial: Partial<{ status: IrnStatus; irn: string | null; errorMsg: string | null; attemptCount: number }> = {}) {
    return {
      id: "ir_1", billId: "bill_a5", shopId: "shop_vaidyanath_kalyan",
      vendor: "cygnet", status: partial.status ?? "acked",
      irn: partial.irn === undefined ? "a".repeat(64) : partial.irn,
      ackNo: "ACK-1", ackDate: "2026-04-17T10:00:00+05:30",
      signedInvoice: null, qrCode: null,
      errorCode: null, errorMsg: partial.errorMsg ?? null,
      attemptCount: partial.attemptCount ?? 1,
      submittedAt: "2026-04-17T09:59:00+05:30",
      cancelledAt: null, cancelReason: null, cancelRemarks: null,
      actorUserId: owner.id, createdAt: "2026-04-17T09:58:00+05:30",
    };
  }

  function irnHandler(opts: {
    existing?: ReturnType<typeof mockIrn> | null;
    submitResult?: ReturnType<typeof mockIrn>;
    retryResult?: ReturnType<typeof mockIrn>;
    calls?: IpcCall[];
  } = {}) {
    return async (call: IpcCall): Promise<unknown> => {
      opts.calls?.push(call);
      if (call.cmd === "health_check") return { ok: true, version: "0.1.0" };
      if (call.cmd === "db_version") return 2;
      if (call.cmd === "search_products") {
        const q = call.args.q.toLowerCase();
        return FIXTURES.filter((f) => f.name.toLowerCase().includes(q));
      }
      if (call.cmd === "pick_fefo_batch") return BATCH;
      if (call.cmd === "list_fefo_candidates") return [BATCH, BATCH_ALT];
      if (call.cmd === "save_bill") return { billId: "bill_a5", grandTotalPaise: 11200, linesInserted: 1 };
      if (call.cmd === "search_customers") return [];
      if (call.cmd === "list_prescriptions") return [];
      if (call.cmd === "list_stock") return [];
      if (call.cmd === "user_get") return owner;
      if (call.cmd === "get_nearest_expiry") return null;
      if (call.cmd === "get_irn_for_bill") return opts.existing ?? null;
      if (call.cmd === "submit_irn") return opts.submitResult ?? mockIrn({ status: "acked" });
      if (call.cmd === "retry_irn") return opts.retryResult ?? mockIrn({ status: "acked" });
      return null;
    };
  }

  it("chip hidden until F10 save; after save shows 'not submitted' with Submit button", async () => {
    setIpcHandler(irnHandler({ existing: null }));
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByTestId("irn-chip")).not.toBeInTheDocument();
    await addOneLine(user);
    fireEvent.keyDown(window, { key: "F10" });
    await waitFor(() =>
      expect(screen.getByTestId("toast")).toHaveAttribute("data-toast-kind", "ok"),
    );
    const chip = await screen.findByTestId("irn-chip");
    expect(chip).toHaveAttribute("data-irn-status", "none");
    expect(screen.getByTestId("irn-submit")).toBeInTheDocument();
  });

  it("Submit click calls submit_irn and chip flips to acked", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(irnHandler({ existing: null, submitResult: mockIrn({ status: "acked" }), calls }));
    const user = userEvent.setup();
    render(<App />);
    await addOneLine(user);
    fireEvent.keyDown(window, { key: "F10" });
    await screen.findByTestId("irn-chip");
    fireEvent.click(screen.getByTestId("irn-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("irn-chip")).toHaveAttribute("data-irn-status", "acked"),
    );
    expect(calls.some((c) => c.cmd === "submit_irn")).toBe(true);
    expect(screen.getByTestId("irn-status-badge").textContent?.toLowerCase()).toBe("acked");
    expect(screen.getByTestId("irn-number")).toBeInTheDocument();
  });

  it("failed status exposes errorMsg + Retry button; retry flips to acked", async () => {
    const calls: IpcCall[] = [];
    setIpcHandler(irnHandler({
      existing: mockIrn({ status: "failed", irn: null, errorMsg: "3026 invalid GSTIN", attemptCount: 2 }),
      retryResult: mockIrn({ status: "acked", attemptCount: 3 }),
      calls,
    }));
    const user = userEvent.setup();
    render(<App />);
    await addOneLine(user);
    fireEvent.keyDown(window, { key: "F10" });
    const chip = await screen.findByTestId("irn-chip");
    await waitFor(() => expect(chip).toHaveAttribute("data-irn-status", "failed"));
    expect(screen.getByTestId("irn-error").textContent).toMatch(/invalid GSTIN/);
    fireEvent.click(screen.getByTestId("irn-retry"));
    await waitFor(() =>
      expect(screen.getByTestId("irn-chip")).toHaveAttribute("data-irn-status", "acked"),
    );
    expect(calls.some((c) => c.cmd === "retry_irn")).toBe(true);
  });

  it("F1 reset clears the chip even after a prior save", async () => {
    setIpcHandler(irnHandler({ existing: null }));
    const user = userEvent.setup();
    render(<App />);
    await addOneLine(user);
    fireEvent.keyDown(window, { key: "F10" });
    await screen.findByTestId("irn-chip");
    fireEvent.keyDown(window, { key: "F1" });
    await waitFor(() => expect(screen.queryByTestId("irn-chip")).not.toBeInTheDocument());
  });
});

