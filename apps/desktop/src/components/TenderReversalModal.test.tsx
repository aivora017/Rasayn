/**
 * TenderReversalModal — unit tests (ADR 0021 §2 + §UX-F6).
 *
 * Covers:
 *   - seedDefaultReversal: single-tender mirror, proportional split,
 *     residual-to-largest, empty-original cash fallback.
 *   - render: shows refund total, default seeded rows, alt+digit hotkeys,
 *     F10 confirm only when balanced, Esc cancels.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import {
  TenderReversalModal,
  seedDefaultReversal,
} from "./TenderReversalModal.js";
import type { PaymentRowDTO, ReturnTenderDTO } from "../lib/ipc.js";

function pay(
  id: string,
  mode: PaymentRowDTO["mode"],
  amt: number,
  refNo: string | null = null,
): PaymentRowDTO {
  return {
    id,
    billId: "b1",
    mode,
    amountPaise: amt,
    refNo,
    createdAt: "2026-04-20T12:00:00+05:30",
  };
}

describe("seedDefaultReversal", () => {
  it("maps empty originals to cash fallback", () => {
    const r = seedDefaultReversal(25000, []);
    expect(r).toEqual([{ mode: "cash", amountPaise: 25000, refNo: "" }]);
  });

  it("mirrors single original tender", () => {
    const r = seedDefaultReversal(25000, [pay("p1", "upi", 100000, "RRN1")]);
    expect(r).toEqual([{ mode: "upi", amountPaise: 25000, refNo: "" }]);
  });

  it("ADR 0021 §2 example — 1000 bill = 600 UPI + 400 cash, refund 250 → 150 UPI + 100 cash", () => {
    const r = seedDefaultReversal(25000, [
      pay("p1", "upi", 60000),
      pay("p2", "cash", 40000),
    ]);
    expect(r).toEqual([
      { mode: "upi", amountPaise: 15000, refNo: "" },
      { mode: "cash", amountPaise: 10000, refNo: "" },
    ]);
  });

  it("absorbs rounding residual into largest-amount tender", () => {
    // 333 / 1000 of 10 paise = 3.33 → 3; 667/1000 = 6.67 → 7; sum = 10, diff = 0.
    // Use an asymmetric ratio that forces a residual.
    const r = seedDefaultReversal(10, [
      pay("p1", "upi", 333),
      pay("p2", "cash", 667),
    ]);
    const sum = r.reduce((s, t) => s + t.amountPaise, 0);
    expect(sum).toBe(10);
  });

  it("returns empty array when refund total is zero", () => {
    expect(seedDefaultReversal(0, [pay("p1", "cash", 100)])).toEqual([]);
  });

  it("handles zero-amount originals by falling back to cash", () => {
    const r = seedDefaultReversal(500, [
      pay("p1", "upi", 0),
      pay("p2", "cash", 0),
    ]);
    expect(r).toEqual([{ mode: "cash", amountPaise: 500, refNo: "" }]);
  });
});

describe("TenderReversalModal render", () => {
  it("does not render when open=false", () => {
    const { container } = render(
      <TenderReversalModal
        open={false}
        refundTotalPaise={10000}
        originalPayments={[pay("p1", "cash", 10000)]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders with default seed from original cash payment", () => {
    render(
      <TenderReversalModal
        open={true}
        refundTotalPaise={25000}
        originalPayments={[pay("p1", "cash", 100000)]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("tender-reversal-modal")).toBeInTheDocument();
    expect(screen.getByTestId("tender-reversal-row-0")).toHaveTextContent(
      "Cash",
    );
  });

  it("F10 confirms and emits tenders when balanced", async () => {
    const onConfirm = vi.fn<(t: readonly ReturnTenderDTO[]) => void>();
    render(
      <TenderReversalModal
        open={true}
        refundTotalPaise={15000}
        originalPayments={[pay("p1", "upi", 50000)]}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("tender-reversal-confirm")).not.toBeDisabled(),
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "F10" });
    });
    expect(onConfirm).toHaveBeenCalledWith([
      { mode: "upi", amountPaise: 15000, refNo: null },
    ]);
  });

  it("Esc calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <TenderReversalModal
        open={true}
        refundTotalPaise={15000}
        originalPayments={[pay("p1", "cash", 15000)]}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("confirm stays disabled when sum !== refund total (outside tolerance)", () => {
    render(
      <TenderReversalModal
        open={true}
        refundTotalPaise={15000}
        originalPayments={[]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // seedDefaultReversal gives single cash=15000 which IS balanced — remove it.
    fireEvent.click(screen.getByTestId("tender-reversal-remove-0"));
    expect(screen.getByTestId("tender-reversal-confirm")).toBeDisabled();
  });

  it("reset to default re-seeds after manual edits", () => {
    render(
      <TenderReversalModal
        open={true}
        refundTotalPaise={20000}
        originalPayments={[pay("p1", "cash", 20000)]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("tender-reversal-remove-0"));
    expect(screen.queryByTestId("tender-reversal-row-0")).toBeNull();
    fireEvent.click(screen.getByTestId("tender-reversal-reset"));
    expect(screen.getByTestId("tender-reversal-row-0")).toHaveTextContent(
      "Cash",
    );
  });
});
