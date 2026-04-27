// G06 — OwnerOverrideModal coverage (coverage-gaps 2026-04-18 §G06).
//
// A13 expiry-override is the ONLY gate between any cashier and silent
// expiry-override fraud. The Rust side enforces REASON_TOO_SHORT (>= 4)
// and OVERRIDE_FORBIDDEN (role != owner); the modal must mirror those
// exactly so the UX never surfaces an opaque server error for a user
// that shouldn't have been allowed to confirm in the first place.
//
// This suite covers (per ADR 0013 + ADR 0009 modal shell):
//
//   - open=false renders null (no DOM noise, no key listeners attached)
//   - target/role/days info renders with correct severity tone
//   - Confirm button disabled until reason >= 4 chars trimmed
//   - Non-owner role: textarea + confirm both blocked, banner shown
//   - F10 fires confirm only when canConfirm === true
//   - Esc fires onCancel without calling the RPC
//   - Success path forwards auditId to onOverride, RPC arg shape correct
//   - Server-side rejection surfaces inline, modal stays open
//   - Reason gets reset across reopens (no stale leak between lines)

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OwnerOverrideModal, type ExpiryOverrideTarget } from "./OwnerOverrideModal.js";
import {
  setIpcHandler,
  type ExpiryOverrideInputDTO,
  type ExpiryOverrideResultDTO,
  type IpcCall,
  type UserDTO,
} from "../lib/ipc.js";

const OWNER: UserDTO = { id: "u_sourav", name: "Sourav (Owner)", role: "owner", isActive: true };
const CASHIER: UserDTO = { id: "u_neha", name: "Neha (Cashier)", role: "cashier", isActive: true };
const INACTIVE_OWNER: UserDTO = { id: "u_old", name: "Old Owner", role: "owner", isActive: false };

const TARGET: ExpiryOverrideTarget = {
  batchId: "b_crocin_2026_05",
  batchNo: "BX12345",
  expiryDate: "2026-05-15",
  daysToExpiry: 18,
  productName: "Crocin 500",
};

interface HandlerOpts {
  /** What recordExpiryOverrideRpc should resolve with. */
  result?: ExpiryOverrideResultDTO;
  /** If set, the RPC throws this error instead. */
  throws?: string;
  /** Accumulator capturing every IpcCall in order. */
  calls?: IpcCall[];
}

function installHandler(opts: HandlerOpts = {}): void {
  const calls = opts.calls ?? [];
  setIpcHandler(async (call: IpcCall) => {
    calls.push(call);
    switch (call.cmd) {
      case "record_expiry_override":
        if (opts.throws) throw new Error(opts.throws);
        return (
          opts.result ?? {
            auditId: "audit_xyz_001",
            daysPastExpiry: 0,
          }
        );
      default:
        return null;
    }
  });
}

describe("OwnerOverrideModal — G06 expiry-override gate (ADR 0013)", () => {
  it("open=false renders null and attaches no key listener", () => {
    const onOverride = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <OwnerOverrideModal
        open={false}
        target={TARGET}
        currentUser={OWNER}
        onOverride={onOverride}
        onCancel={onCancel}
      />,
    );
    expect(container.firstChild).toBeNull();
    // Esc/F10 must be no-ops when closed.
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "F10" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(onOverride).not.toHaveBeenCalled();
  });

  it("renders target/batch/days and reason textarea autofocused", async () => {
    render(
      <OwnerOverrideModal
        open={true}
        target={TARGET}
        currentUser={OWNER}
        onOverride={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("expiry-override-modal")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("expiry-override-product").textContent).toBe("Crocin 500");
    expect(screen.getByTestId("expiry-override-batch").textContent ?? "").toMatch(/BX12345.*2026-05-15/);
    expect(screen.getByTestId("expiry-override-days").textContent ?? "").toMatch(/18 days to expiry/);
    // queueMicrotask focuses the textarea after open.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId("expiry-override-reason"));
    });
  });

  it("Confirm disabled with empty / 3-char reason; enabled at 4-char trimmed", async () => {
    const user = userEvent.setup();
    render(
      <OwnerOverrideModal
        open={true}
        target={TARGET}
        currentUser={OWNER}
        onOverride={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const confirm = screen.getByTestId("expiry-override-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const reason = screen.getByTestId("expiry-override-reason") as HTMLTextAreaElement;
    await user.type(reason, "ok");
    expect(confirm.disabled).toBe(true);

    await user.type(reason, "ay"); // total 4 chars now → enables
    expect(confirm.disabled).toBe(false);

    // Whitespace shouldn't count: clear and type only spaces.
    await user.clear(reason);
    await user.type(reason, "    ");
    expect(confirm.disabled).toBe(true);
  });

  it("non-owner role: textarea disabled, confirm disabled, role banner shown", () => {
    render(
      <OwnerOverrideModal
        open={true}
        target={TARGET}
        currentUser={CASHIER}
        onOverride={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const banner = screen.getByTestId("expiry-override-role-warn");
    expect(banner.textContent ?? "").toMatch(/Only an owner can approve/);
    expect(banner.textContent ?? "").toMatch(/Neha \(Cashier\)/);
    expect(banner.textContent ?? "").toMatch(/cashier/);

    expect((screen.getByTestId("expiry-override-reason") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByTestId("expiry-override-confirm") as HTMLButtonElement).disabled).toBe(true);
  });

  it("inactive-owner is treated as non-owner (isActive must also be true)", () => {
    render(
      <OwnerOverrideModal
        open={true}
        target={TARGET}
        currentUser={INACTIVE_OWNER}
        onOverride={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("expiry-override-role-warn")).toBeInTheDocument();
    expect((screen.getByTestId("expiry-override-confirm") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Esc fires onCancel without calling record_expiry_override", () => {
    const calls: IpcCall[] = [];
    installHandler({ calls });
    const onCancel = vi.fn();
    render(
      <OwnerOverrideModal
        open={true}
        target={TARGET}
        currentUser={OWNER}
        onOverride={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.cmd === "record_expiry_override")).toBe(false);
  });

  it("F10 only fires confirm when canConfirm === true", async () => {
    const calls: IpcCall[] = [];
    installHandler({ calls });
    const onOverride = vi.fn();

    const user = userEvent.setup();
    render(
      <OwnerOverrideModal
        open={true}
        target={TARGET}
        currentUser={OWNER}
        onOverride={onOverride}
        onCancel={vi.fn()}
      />,
    );

    // Empty reason — F10 is a no-op.
    fireEvent.keyDown(window, { key: "F10" });
    expect(calls.some((c) => c.cmd === "record_expiry_override")).toBe(false);

    await user.type(screen.getByTestId("expiry-override-reason"), "Lab demand");
    await act(async () => {
      fireEvent.keyDown(window, { key: "F10" });
      // Flush the awaited rpc microtask + onOverride scheduling.
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    await waitFor(() => expect(onOverride).toHaveBeenCalledTimes(1));
    const rpc = calls.find((c) => c.cmd === "record_expiry_override");
    expect(rpc).toBeTruthy();
  });

  it("happy path: trimmed reason sent, onOverride forwards auditId", async () => {
    const calls: IpcCall[] = [];
    installHandler({
      calls,
      result: { auditId: "audit_pilot_42", daysPastExpiry: 0 },
    });
    const onOverride = vi.fn();

    const user = userEvent.setup();
    render(
      <OwnerOverrideModal
        open={true}
        target={TARGET}
        currentUser={OWNER}
        onOverride={onOverride}
        onCancel={vi.fn()}
      />,
    );

    // Reason has padding — must be trimmed in payload.
    await user.type(screen.getByTestId("expiry-override-reason"), "  hospital tender exigency   ");
    await user.click(screen.getByTestId("expiry-override-confirm"));

    await waitFor(() => expect(onOverride).toHaveBeenCalledTimes(1));
    const firstCall = onOverride.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(firstCall?.[0]).toEqual({
      auditId: "audit_pilot_42",
      daysPastExpiry: 0,
    });

    const rpc = calls.find((c) => c.cmd === "record_expiry_override");
    expect(rpc).toBeTruthy();
    if (rpc && rpc.cmd === "record_expiry_override") {
      const inp = rpc.args.input as ExpiryOverrideInputDTO;
      expect(inp.batchId).toBe("b_crocin_2026_05");
      expect(inp.actorUserId).toBe("u_sourav");
      expect(inp.reason).toBe("hospital tender exigency");
    }
  });

  it("RPC rejection surfaces error inline; modal stays open", async () => {
    installHandler({ throws: "REASON_TOO_SHORT: server requires 4 chars" });
    const onOverride = vi.fn();
    const onCancel = vi.fn();

    const user = userEvent.setup();
    render(
      <OwnerOverrideModal
        open={true}
        target={TARGET}
        currentUser={OWNER}
        onOverride={onOverride}
        onCancel={onCancel}
      />,
    );

    await user.type(screen.getByTestId("expiry-override-reason"), "abcd");
    await user.click(screen.getByTestId("expiry-override-confirm"));

    const errEl = await screen.findByTestId("expiry-override-error");
    expect(errEl.textContent ?? "").toMatch(/REASON_TOO_SHORT/);
    expect(onOverride).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    // Modal still mounted, ready for retry.
    expect(screen.getByTestId("expiry-override-modal")).toBeInTheDocument();
    // Confirm re-enabled (submitting flag cleared) so owner can retry.
    expect((screen.getByTestId("expiry-override-confirm") as HTMLButtonElement).disabled).toBe(false);
  });

  it("reason resets between opens (no stale leak across lines)", async () => {
    installHandler({});
    const user = userEvent.setup();

    const { rerender } = render(
      <OwnerOverrideModal
        open={true}
        target={TARGET}
        currentUser={OWNER}
        onOverride={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await user.type(screen.getByTestId("expiry-override-reason"), "stale reason from prev line");

    // Simulate parent closing then reopening (e.g. cashier hits next near-expiry line).
    rerender(
      <OwnerOverrideModal
        open={false}
        target={TARGET}
        currentUser={OWNER}
        onOverride={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    rerender(
      <OwnerOverrideModal
        open={true}
        target={{ ...TARGET, batchId: "b_other", productName: "Dolo 650" }}
        currentUser={OWNER}
        onOverride={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Effect runs after render → reason should be cleared.
    await waitFor(() => {
      expect((screen.getByTestId("expiry-override-reason") as HTMLTextAreaElement).value).toBe("");
    });
    expect(screen.getByTestId("expiry-override-product").textContent).toBe("Dolo 650");
    expect((screen.getByTestId("expiry-override-confirm") as HTMLButtonElement).disabled).toBe(true);
  });
});
