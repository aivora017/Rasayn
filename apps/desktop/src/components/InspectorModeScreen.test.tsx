// S26 Wave 2 Agent B — InspectorModeScreen now hydrates Schedule counts
// from the real list_schedule_register IPC (was Array.from({length:47}).
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ToasterProvider } from "@pharmacare/design-system";
import InspectorModeScreen from "./InspectorModeScreen";
import {
  setIpcHandler,
  type IpcCall,
  type ScheduleRegisterRowDTO,
} from "../lib/ipc.js";

function row(o: Partial<ScheduleRegisterRowDTO> & { schedule: ScheduleRegisterRowDTO["schedule"] }): ScheduleRegisterRowDTO {
  return {
    billId: o.billId ?? `b_${Math.random().toString(36).slice(2,8)}`,
    billNo: o.billNo ?? "B-000",
    billedAt: o.billedAt ?? "2026-05-01",
    schedule: o.schedule,
    customerName: o.customerName ?? "Cust",
    doctorName: o.doctorName ?? "Dr. X",
    doctorRegNo: o.doctorRegNo ?? "MH-00000",
    drug: o.drug ?? "Drug",
    batchNo: o.batchNo ?? "BN",
    qty: o.qty ?? 1,
    rxImage: o.rxImage,
    witnessName: o.witnessName,
  };
}

function withIpc(rows: readonly ScheduleRegisterRowDTO[]): void {
  setIpcHandler(async (call: IpcCall) => {
    if (call.cmd === "list_schedule_register") return rows;
    return null;
  });
}

describe("InspectorModeScreen (S26 Wave 2 Agent B)", () => {
  beforeEach(() => {
    setIpcHandler(async () => null);
  });

  it("aggregates H / H1 / X counts from list_schedule_register", async () => {
    const rows: ScheduleRegisterRowDTO[] = [
      row({ billId: "h1", schedule: "H",  rxImage: true }),
      row({ billId: "h2", schedule: "H",  rxImage: true }),
      row({ billId: "h3", schedule: "H",  rxImage: false }), // raises a flag
      row({ billId: "h11", schedule: "H1", rxImage: true }),
      row({ billId: "x1", schedule: "X",  rxImage: true, witnessName: "Pharmacist B" }),
      row({ billId: "x2", schedule: "X",  rxImage: true /* no witness -> raises a flag */ }),
    ];
    withIpc(rows);
    render(
      <ToasterProvider>
        <InspectorModeScreen today={new Date(Date.UTC(2026, 4, 6))} />
      </ToasterProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("count-h").textContent).toBe("3");
    });
    expect(screen.getByTestId("count-h1").textContent).toBe("1");
    expect(screen.getByTestId("count-x").textContent).toBe("2");
    // Flags: 1 missing rx (h3) + 1 missing witness (x2) = 2.
    expect(screen.getByTestId("count-flags").textContent).toMatch(/2/);
  });

  it("shows zero state when the period has no Schedule dispenses", async () => {
    withIpc([]);
    render(
      <ToasterProvider>
        <InspectorModeScreen today={new Date(Date.UTC(2026, 4, 6))} />
      </ToasterProvider>,
    );
    expect(await screen.findByTestId("inspector-empty")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-empty").textContent).toMatch(/No Schedule dispenses/);
  });
});
