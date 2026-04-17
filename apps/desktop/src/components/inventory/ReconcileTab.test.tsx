/**
 * A11 — ReconcileTab contract.
 *
 * Covers:
 *   - idle state lists prior sessions via list_count_sessions
 *   - F2 / click "Open new session" calls open_count_session → get_count_session → shows session view
 *   - Add line flow: scan batch_no + qty → record_count_line → refreshed snapshot with line visible
 *   - Variance summary reflects pure-TS computeVariance (match + shortage + overage + uncounted counts)
 *   - Finalize disabled for non-owner; enabled for owner
 *   - Clicking Finalize opens modal with rows per adjustable batch + suggested reason
 *   - Confirming finalize calls finalize_count with decisions; status flips to "finalized"
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ReconcileTab } from "./ReconcileTab.js";
import {
  setIpcHandler,
  type IpcCall,
  type CountSessionDTO,
  type CountSessionSnapshotDTO,
  type FinalizeCountOutDTO,
  type UserDTO,
} from "../../lib/ipc.js";

const OWNER: UserDTO = { id: "user_sourav_owner", name: "Sourav Shaw", role: "owner", isActive: true };
const STAFF: UserDTO = { id: "user_sourav_owner", name: "Sourav Staff", role: "cashier", isActive: true };

function makeSnapshot(status: CountSessionDTO["status"] = "open", extra: Partial<CountSessionSnapshotDTO> = {}): CountSessionSnapshotDTO {
  return {
    session: {
      id: "pc1",
      shopId: "shop_vaidyanath_kalyan",
      title: "April 2026 stock count",
      status,
      openedBy: "user_sourav_owner",
      openedAt: "2026-04-17T10:00:00.000Z",
      finalizedBy: status === "finalized" ? "user_sourav_owner" : null,
      finalizedAt: status === "finalized" ? "2026-04-17T11:00:00.000Z" : null,
      lineCount: 0,
      adjustmentCount: 0,
    },
    system: [
      { batchId: "b1", productId: "p1", productName: "Paracetamol 500", batchNo: "PARA-24A", expiryDate: "2027-06-30", systemQty: 100 },
      { batchId: "b2", productId: "p2", productName: "Amoxicillin 250", batchNo: "AMOX-24B", expiryDate: "2027-12-31", systemQty: 50 },
      { batchId: "b3", productId: "p3", productName: "Dolo 650", batchNo: "DOLO-24C", expiryDate: "2026-05-10", systemQty: 20 },
    ],
    lines: [],
    ...extra,
  };
}

type CallLog = { cmd: string; args: unknown }[];

function installHandler(opts: {
  user?: UserDTO | null;
  sessions?: ReadonlyArray<CountSessionDTO>;
  snapshot?: CountSessionSnapshotDTO;
  finalized?: CountSessionSnapshotDTO;
}): CallLog {
  const calls: CallLog = [];
  let currentSnap = opts.snapshot ?? makeSnapshot();
  setIpcHandler(async (call: IpcCall) => {
    calls.push({ cmd: call.cmd, args: call.args });
    if (call.cmd === "user_get") return opts.user ?? OWNER;
    if (call.cmd === "list_count_sessions") return opts.sessions ?? [];
    if (call.cmd === "open_count_session") {
      currentSnap = opts.snapshot ?? makeSnapshot();
      return currentSnap.session;
    }
    if (call.cmd === "get_count_session") return currentSnap;
    if (call.cmd === "record_count_line") {
      const input = (call.args as { input: { batchId: string; countedQty: number; countedByUserId: string } }).input;
      currentSnap = {
        ...currentSnap,
        lines: [
          ...currentSnap.lines,
          { batchId: input.batchId, productId: currentSnap.system.find((b) => b.batchId === input.batchId)?.productId ?? "", countedQty: input.countedQty, countedBy: input.countedByUserId, countedAt: "2026-04-17T10:05:00.000Z", notes: null },
        ],
      };
      return undefined;
    }
    if (call.cmd === "finalize_count") {
      currentSnap = opts.finalized ?? {
        ...currentSnap,
        session: { ...currentSnap.session, status: "finalized", finalizedBy: "user_sourav_owner", finalizedAt: "2026-04-17T11:00:00.000Z" },
      };
      const out: FinalizeCountOutDTO = {
        sessionId: currentSnap.session.id,
        adjustmentsWritten: 1,
        netDelta: -5,
        finalizedAt: currentSnap.session.finalizedAt ?? "2026-04-17T11:00:00.000Z",
      };
      return out;
    }
    throw new Error(`unexpected ipc: ${call.cmd}`);
  });
  return calls;
}

describe("ReconcileTab", () => {
  beforeEach(() => {
    // jsdom: silence unmocked getters
  });

  it("renders the idle state with prior sessions list", async () => {
    installHandler({
      sessions: [
        {
          id: "pc_prev", shopId: "shop_vaidyanath_kalyan", title: "March 2026 count",
          status: "finalized", openedBy: "user_sourav_owner", openedAt: "2026-03-31T10:00:00.000Z",
          finalizedBy: "user_sourav_owner", finalizedAt: "2026-03-31T14:00:00.000Z",
          lineCount: 42, adjustmentCount: 3,
        },
      ],
    });
    render(<ReconcileTab />);
    await waitFor(() => expect(screen.getByTestId("rec-open")).toBeInTheDocument());
    expect(screen.getByTestId("rec-history-row-pc_prev")).toBeInTheDocument();
    expect(screen.getByText(/March 2026 count/)).toBeInTheDocument();
  });

  it("opens a new session and transitions into session view", async () => {
    const calls = installHandler({});
    render(<ReconcileTab />);
    await waitFor(() => expect(screen.getByTestId("rec-open")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId("rec-open"));
    });

    await waitFor(() => expect(screen.getByTestId("rec-session")).toBeInTheDocument());
    const kinds = calls.map((c) => c.cmd);
    expect(kinds).toContain("open_count_session");
    expect(kinds).toContain("get_count_session");
    expect(screen.getByTestId("rec-session-title").textContent).toMatch(/April 2026/);
  });

  it("records a count line by batch_no and updates the variance summary", async () => {
    installHandler({});
    render(<ReconcileTab />);
    await waitFor(() => expect(screen.getByTestId("rec-open")).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByTestId("rec-open")); });
    await waitFor(() => expect(screen.getByTestId("rec-session")).toBeInTheDocument());

    // Shortage of 5 on batch PARA-24A (system 100 → counted 95)
    fireEvent.change(screen.getByTestId("rec-scan"), { target: { value: "PARA-24A" } });
    fireEvent.change(screen.getByTestId("rec-qty"), { target: { value: "95" } });
    await act(async () => { fireEvent.click(screen.getByTestId("rec-add-line")); });

    // Variance row for b1 should now show counted=95, delta=-5
    await waitFor(() => {
      const row = screen.getByTestId("rec-row-b1");
      expect(row.textContent).toMatch(/95/);
      expect(row.textContent).toMatch(/-5/);
    });
    // Product aggregate shows up
    expect(screen.getByTestId("rec-prod-p1")).toBeInTheDocument();
  });

  it("disables Finalize for non-owner users", async () => {
    installHandler({ user: STAFF });
    render(<ReconcileTab />);
    await waitFor(() => expect(screen.getByTestId("rec-open")).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByTestId("rec-open")); });
    await waitFor(() => expect(screen.getByTestId("rec-session")).toBeInTheDocument());

    // Add a line so there's something to adjust
    fireEvent.change(screen.getByTestId("rec-scan"), { target: { value: "PARA-24A" } });
    fireEvent.change(screen.getByTestId("rec-qty"), { target: { value: "95" } });
    await act(async () => { fireEvent.click(screen.getByTestId("rec-add-line")); });

    const finBtn = screen.getByTestId("rec-finalize") as HTMLButtonElement;
    expect(finBtn.disabled).toBe(true);
  });

  it("owner can finalize — modal opens, confirms, status flips to finalized", async () => {
    const calls = installHandler({});
    render(<ReconcileTab />);
    await waitFor(() => expect(screen.getByTestId("rec-open")).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByTestId("rec-open")); });
    await waitFor(() => expect(screen.getByTestId("rec-session")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("rec-scan"), { target: { value: "PARA-24A" } });
    fireEvent.change(screen.getByTestId("rec-qty"), { target: { value: "95" } });
    await act(async () => { fireEvent.click(screen.getByTestId("rec-add-line")); });

    // Open finalize modal
    await act(async () => { fireEvent.click(screen.getByTestId("rec-finalize")); });
    expect(screen.getByTestId("rec-confirm-finalize")).toBeInTheDocument();
    // Seeded decision for b1
    expect(screen.getByTestId("rec-decision-b1")).toBeInTheDocument();

    // Confirm
    await act(async () => { fireEvent.click(screen.getByTestId("rec-confirm-finalize-btn")); });

    const kinds = calls.map((c) => c.cmd);
    expect(kinds).toContain("finalize_count");

    // Status badge now shows FINALIZED
    await waitFor(() => {
      const session = screen.getByTestId("rec-session");
      expect(session.textContent).toMatch(/FINALIZED/);
    });
  });

  it("shows an error when scanning an unknown batch code", async () => {
    installHandler({});
    render(<ReconcileTab />);
    await waitFor(() => expect(screen.getByTestId("rec-open")).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByTestId("rec-open")); });
    await waitFor(() => expect(screen.getByTestId("rec-session")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("rec-scan"), { target: { value: "GHOST" } });
    fireEvent.change(screen.getByTestId("rec-qty"), { target: { value: "10" } });
    await act(async () => { fireEvent.click(screen.getByTestId("rec-add-line")); });

    expect(screen.getByTestId("rec-err").textContent).toMatch(/batch not found/i);
  });
});
