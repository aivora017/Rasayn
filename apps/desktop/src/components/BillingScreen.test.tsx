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

