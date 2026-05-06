// S26 Wave 2 Agent B — read-screen wired to list_schedule_register IPC.
// Verifies: rows render from IPC, period filter re-fires IPC with correct
// camelCase args, empty state renders when result is [].
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ToasterProvider } from "@pharmacare/design-system";
import ComplianceScheduleHTab from "./ComplianceScheduleHTab.js";
import {
  setIpcHandler,
  type IpcCall,
  type ScheduleRegisterRowDTO,
} from "../lib/ipc.js";

const ROWS: readonly ScheduleRegisterRowDTO[] = [
  { billId: "b1", billNo: "B-101", billedAt: "2026-04-15", schedule: "H",
    customerName: "Aarti Sen", doctorName: "Dr. Verma", doctorRegNo: "MH-99001",
    drug: "Amoxicillin 500mg", batchNo: "BN-AMX-23", qty: 21, rxImage: true },
  { billId: "b2", billNo: "B-102", billedAt: "2026-04-16", schedule: "H1",
    customerName: "Suresh K.", doctorName: "Dr. Bose", doctorRegNo: "MH-99002",
    drug: "Tramadol 50mg", batchNo: "BN-TRM-12", qty: 10, rxImage: true },
];

function withIpc(args: { rows?: readonly ScheduleRegisterRowDTO[]; calls?: IpcCall[] }): void {
  setIpcHandler(async (call: IpcCall) => {
    args.calls?.push(call);
    if (call.cmd === "list_schedule_register") return args.rows ?? [];
    if (call.cmd === "schedule_register_pdf_path") return "/tmp/sched.pdf";
    return null;
  });
}

describe("ComplianceScheduleHTab (S26 Wave 2 Agent B)", () => {
  beforeEach(() => {
    setIpcHandler(async () => null);
  });

  it("renders rows hydrated from list_schedule_register IPC", async () => {
    withIpc({ rows: ROWS });
    render(
      <ToasterProvider>
        <ComplianceScheduleHTab today={new Date(Date.UTC(2026, 3, 28))} />
      </ToasterProvider>,
    );
    expect(await screen.findByText("Aarti Sen")).toBeInTheDocument();
    expect(screen.getByText("Suresh K.")).toBeInTheDocument();
    expect(screen.getByText("Amoxicillin 500mg")).toBeInTheDocument();
    expect(screen.getByTestId("sched-row-count").textContent).toMatch(/2 entries/);
  });

  it("re-fires list_schedule_register with correct camelCase args when period filter changes", async () => {
    const calls: IpcCall[] = [];
    withIpc({ rows: ROWS, calls });
    render(
      <ToasterProvider>
        <ComplianceScheduleHTab shopId="shop_local" today={new Date(Date.UTC(2026, 3, 28))} />
      </ToasterProvider>,
    );
    await waitFor(() => {
      expect(calls.some((c) => c.cmd === "list_schedule_register")).toBe(true);
    });
    const first = calls.find((c) => c.cmd === "list_schedule_register")!;
    expect(first.args).toMatchObject({
      periodStartIso: "2026-04-01",
      periodEndIso: "2026-04-30",
      schedule: "all",
      shopId: "shop_local",
    });

    // Switch to Schedule X filter -> IPC should re-fire with schedule="X".
    fireEvent.click(screen.getByTestId("sched-filter-X"));
    await waitFor(() => {
      expect(calls.filter((c) => c.cmd === "list_schedule_register").length).toBeGreaterThanOrEqual(2);
    });
    const last = calls.filter((c) => c.cmd === "list_schedule_register").pop()!;
    expect(last.args).toMatchObject({
      periodStartIso: "2026-04-01",
      periodEndIso: "2026-04-30",
      schedule: "X",
      shopId: "shop_local",
    });
  });

  it("shows the empty state when IPC returns []", async () => {
    withIpc({ rows: [] });
    render(
      <ToasterProvider>
        <ComplianceScheduleHTab today={new Date(Date.UTC(2026, 3, 28))} />
      </ToasterProvider>,
    );
    expect(await screen.findByTestId("sched-empty")).toBeInTheDocument();
    expect(screen.getByTestId("sched-empty").textContent).toMatch(/No Schedule-H\/H1\/X dispenses/);
  });
});
