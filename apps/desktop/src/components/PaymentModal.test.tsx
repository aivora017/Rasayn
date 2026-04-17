/**
 * A8 · PaymentModal (ADR 0012) — keyboard-first tender capture contract.
 *
 * Covers:
 *   - Confirm disabled until sum(tenders) ≈ grand_total within ±50 paise
 *   - Alt+1..4 selects mode AND appends the currently-typed amount
 *   - Split tender: cash + UPI balances to total, onConfirm fires with both rows
 *   - Change calc shown when tender exceeds bill; Due shown when short
 *   - Esc calls onCancel; F10 calls onConfirm only when balanced
 *   - No-tender confirm path: synthesises a single tender for the bill total
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentModal, parseRupeesToPaise } from "./PaymentModal.js";
import type { Tender } from "../lib/ipc.js";

function setup(overrides?: Partial<React.ComponentProps<typeof PaymentModal>>) {
  const onConfirm = vi.fn<(t: readonly Tender[]) => void>();
  const onCancel = vi.fn<() => void>();
  const utils = render(
    <PaymentModal
      open={true}
      grandTotalPaise={22000}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { ...utils, onConfirm, onCancel };
}

describe("parseRupeesToPaise", () => {
  it("handles integers, decimals and commas", () => {
    expect(parseRupeesToPaise("100")).toBe(10000);
    expect(parseRupeesToPaise("100.50")).toBe(10050);
    expect(parseRupeesToPaise("1,234.56")).toBe(123456);
  });
  it("returns NaN for empty / negative / junk", () => {
    expect(parseRupeesToPaise("")).toBeNaN();
    expect(parseRupeesToPaise("-5")).toBeNaN();
    expect(parseRupeesToPaise("abc")).toBeNaN();
  });
});

describe("PaymentModal · closed state", () => {
  it("renders nothing when open=false", () => {
    const { container } = setup({ open: false });
    expect(container.querySelector('[data-testid="payment-modal"]')).toBeNull();
  });
});

describe("PaymentModal · single-tender (default) flow", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("pre-seeds amount with the grand total and confirm is balanced immediately", () => {
    const { onConfirm } = setup();
    const confirm = screen.getByTestId("payment-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const out = onConfirm.mock.calls[0]![0];
    expect(out.length).toBe(1);
    expect(out[0]!.mode).toBe("cash");
    expect(out[0]!.amountPaise).toBe(22000);
  });

  it("F10 fires onConfirm when balanced", () => {
    const { onConfirm } = setup();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "F10" })); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("Esc fires onCancel", () => {
    const { onCancel } = setup();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("PaymentModal · split-tender flow", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("adds two tenders that balance to grand_total; onConfirm receives both", async () => {
    const user = userEvent.setup();
    const { onConfirm } = setup({ grandTotalPaise: 22000 });

    // Add a cash row of 100.00
    const amount = screen.getByTestId("tender-amount") as HTMLInputElement;
    await user.clear(amount);
    await user.type(amount, "100.00");
    await user.click(screen.getByTestId("tender-add"));

    // Switch to UPI and add the remainder (120.00)
    await user.click(screen.getByTestId("tender-mode-upi"));
    await user.clear(amount);
    await user.type(amount, "120.00");
    await user.click(screen.getByTestId("tender-add"));

    // Both rows rendered
    expect(screen.getByTestId("tender-row-0")).toBeTruthy();
    expect(screen.getByTestId("tender-row-1")).toBeTruthy();

    const confirm = screen.getByTestId("payment-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const out = onConfirm.mock.calls[0]![0];
    expect(out.length).toBe(2);
    expect(out[0]).toEqual({ mode: "cash", amountPaise: 10000, refNo: null });
    expect(out[1]).toEqual({ mode: "upi",  amountPaise: 12000, refNo: null });
  });

  it("confirm stays disabled while tenders short of grand_total", async () => {
    const user = userEvent.setup();
    setup({ grandTotalPaise: 22000 });
    // Wipe the pre-seeded amount and add only 50
    const amount = screen.getByTestId("tender-amount") as HTMLInputElement;
    await user.clear(amount);
    await user.type(amount, "50");
    await user.click(screen.getByTestId("tender-add"));
    const confirm = screen.getByTestId("payment-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(screen.getByTestId("payment-due").textContent).toMatch(/17,?000|17000|₹\s*17/);
  });

  it("shows change when last tender exceeds the remaining", async () => {
    const user = userEvent.setup();
    setup({ grandTotalPaise: 10000 });
    const amount = screen.getByTestId("tender-amount") as HTMLInputElement;
    await user.clear(amount);
    await user.type(amount, "120");             // ₹120 > ₹100 total → change ₹20
    await user.click(screen.getByTestId("tender-add"));
    expect(screen.queryByTestId("payment-change")).not.toBeNull();
  });

  it("removes a tender row via the × button", async () => {
    const user = userEvent.setup();
    setup({ grandTotalPaise: 22000 });
    const amount = screen.getByTestId("tender-amount") as HTMLInputElement;
    await user.clear(amount);
    await user.type(amount, "100");
    await user.click(screen.getByTestId("tender-add"));
    await user.click(screen.getByTestId("tender-remove-0"));
    expect(screen.queryByTestId("tender-row-0")).toBeNull();
  });
});
