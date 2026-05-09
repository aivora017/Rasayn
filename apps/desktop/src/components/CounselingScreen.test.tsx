// CounselingScreen — S28-A1 vitest. Covers the cashier-facing flow:
//   1. No bill -> empty "no active bill" state.
//   2. Bill with one missing H drug -> form renders, save disabled
//      until consent box ticked, save dispatches log_counseling with
//      the right shape.
//   3. After save_bill clears, "Continue to bill close" CTA renders.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { setIpcHandler, type IpcCall } from "../lib/ipc.js";
import CounselingScreen from "./CounselingScreen.js";

interface CapturedCall {
  cmd: string;
  args: Record<string, unknown>;
}

function mountHandler(opts: {
  missing?: ReadonlyArray<{ drugId: string; drugName: string; scheduleClass: "H" | "H1" | "X" }>;
  capture?: CapturedCall[];
  /** When true, second call to check_counseling_complete returns []. */
  clearAfterLog?: boolean;
}) {
  let logged = false;
  const handler = async (call: IpcCall): Promise<unknown> => {
    opts.capture?.push({ cmd: call.cmd, args: (call.args ?? {}) as Record<string, unknown> });
    if (call.cmd === "check_counseling_complete") {
      if (opts.clearAfterLog && logged) return [];
      return opts.missing ?? [];
    }
    if (call.cmd === "log_counseling") {
      logged = true;
      return 42; // pretend rowid
    }
    return null;
  };
  setIpcHandler(handler);
}

describe("CounselingScreen — S28-A1", () => {
  beforeEach(() => {
    // permissive — each test installs its own handler
    setIpcHandler(async () => null);
  });
  afterEach(() => cleanup());

  it("1. renders 'no active bill' when billId is undefined", () => {
    render(<CounselingScreen />);
    expect(screen.getByTestId("counsel-no-bill")).toBeInTheDocument();
    // No list / no form
    expect(screen.queryByTestId("counsel-list")).toBeNull();
  });

  it("2. lists missing drugs and disables save until consent ticked", async () => {
    const calls: CapturedCall[] = [];
    mountHandler({
      missing: [
        { drugId: "p_h", drugName: "Atorvastatin 10mg", scheduleClass: "H" },
      ],
      capture: calls,
    });

    render(<CounselingScreen billId="bill_x" counselorUserId="u_rph" />);

    // List card renders.
    await waitFor(() => {
      expect(screen.getByTestId("counsel-card-p_h")).toBeInTheDocument();
    });
    expect(screen.getByTestId("counsel-sched-p_h")).toHaveTextContent("Schedule H");

    const saveBtn = screen.getByTestId("counsel-save-p_h") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    const consent = screen.getByTestId("counsel-consent-p_h") as HTMLInputElement;
    fireEvent.click(consent);
    expect(consent.checked).toBe(true);
    expect((screen.getByTestId("counsel-save-p_h") as HTMLButtonElement).disabled).toBe(false);

    // First IPC call must be check_counseling_complete with the bill id.
    const firstCheck = calls.find((c) => c.cmd === "check_counseling_complete");
    expect(firstCheck?.args).toEqual({ billId: "bill_x" });
  });

  it("3. saving dispatches log_counseling with the expected payload", async () => {
    const calls: CapturedCall[] = [];
    mountHandler({
      missing: [
        { drugId: "p_h1", drugName: "Tramadol 50mg", scheduleClass: "H1" },
      ],
      capture: calls,
      clearAfterLog: true,
    });

    render(<CounselingScreen billId="bill_y" counselorUserId="u_rph" />);

    await waitFor(() => {
      expect(screen.getByTestId("counsel-card-p_h1")).toBeInTheDocument();
    });

    const notes = screen.getByTestId("counsel-notes-p_h1") as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "Avoid driving" } });
    fireEvent.click(screen.getByTestId("counsel-consent-p_h1"));
    fireEvent.click(screen.getByTestId("counsel-save-p_h1"));

    await waitFor(() => {
      expect(calls.some((c) => c.cmd === "log_counseling")).toBe(true);
    });
    const logCall = calls.find((c) => c.cmd === "log_counseling")!;
    expect(logCall.args).toMatchObject({
      billId: "bill_y",
      drugId: "p_h1",
      drugName: "Tramadol 50mg",
      scheduleClass: "H1",
      notes: "Avoid driving",
      patientConsented: true,
      counselorUserId: "u_rph",
    });

    // After save, the all-clear state should render.
    await waitFor(() => {
      expect(screen.getByTestId("counsel-all-done")).toBeInTheDocument();
    });
    expect(screen.getByTestId("counsel-continue")).toBeInTheDocument();
  });

  it("4. invokes onComplete when 'Continue to bill close' is clicked", async () => {
    mountHandler({ missing: [] });
    const onComplete = vi.fn();
    render(<CounselingScreen billId="bill_z" onComplete={onComplete} />);
    await waitFor(() => {
      expect(screen.getByTestId("counsel-all-done")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("counsel-continue"));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
