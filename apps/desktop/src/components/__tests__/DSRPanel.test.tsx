import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DSRPanel from "../DSRPanel";

vi.mock("../../lib/ipc.js", () => ({
  dsrListExportsRpc: vi.fn(async () => [
    {
      id: 1,
      requestId: "dsr_20260508_aaa111",
      customerId: "c1",
      requesterPhone: "+919999999999",
      reason: "access request",
      kind: "access" as const,
      status: "done" as const,
      createdAt: "2026-05-08T10:00:00.000Z",
      fulfilledAt: "2026-05-08T10:00:01.000Z",
      filesPath: "/tmp/dsr/1",
    },
  ]),
  requestPersonalDataExportRpc: vi.fn(async (customerId: string) => ({
    requestId: `dsr_new_${customerId}`,
    files: [
      `/tmp/dsr/dsr_new_${customerId}/customer_${customerId}.json`,
      `/tmp/dsr/dsr_new_${customerId}/customer_${customerId}.csv`,
      `/tmp/dsr/dsr_new_${customerId}/README.txt`,
    ],
  })),
  dsrGetExportStatusRpc: vi.fn(async () => null),
}));

describe("DSRPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the header", async () => {
    render(<DSRPanel />);
    expect(
      await screen.findByRole("heading", { name: /DPDP DSR Auto-Respond/i }),
    ).toBeInTheDocument();
  });

  it("loads recent exports on mount", async () => {
    render(<DSRPanel />);
    await waitFor(() => {
      expect(screen.getByText("c1")).toBeInTheDocument();
      expect(screen.getByText("dsr_20260508_aaa111")).toBeInTheDocument();
    });
  });

  it("shows the new-DSR form fields", async () => {
    render(<DSRPanel />);
    expect(await screen.findByLabelText("customer-id")).toBeInTheDocument();
    expect(screen.getByLabelText("requester-phone")).toBeInTheDocument();
    expect(screen.getByLabelText("reason")).toBeInTheDocument();
    expect(screen.getByTestId("fulfil-btn")).toBeInTheDocument();
  });

  it("dispatches request_personal_data_export when fulfil clicked with valid input", async () => {
    const ipc = await import("../../lib/ipc.js");
    render(<DSRPanel />);
    fireEvent.change(await screen.findByLabelText("customer-id"), {
      target: { value: "c2" },
    });
    fireEvent.change(screen.getByLabelText("requester-phone"), {
      target: { value: "+919000000000" },
    });
    fireEvent.change(screen.getByLabelText("reason"), {
      target: { value: "Customer asked at the counter on 2026-05-08" },
    });
    fireEvent.click(screen.getByTestId("fulfil-btn"));
    await waitFor(() => {
      expect(ipc.requestPersonalDataExportRpc).toHaveBeenCalledWith(
        "c2",
        "+919000000000",
        "Customer asked at the counter on 2026-05-08",
      );
    });
    // The bundle path should be surfaced
    await waitFor(() => {
      expect(screen.getByTestId("last-bundle")).toBeInTheDocument();
    });
  });

  it("rejects fulfil with empty customerId", async () => {
    const ipc = await import("../../lib/ipc.js");
    render(<DSRPanel />);
    await screen.findByLabelText("customer-id");
    fireEvent.click(screen.getByTestId("fulfil-btn"));
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/Customer ID/i);
    });
    expect(ipc.requestPersonalDataExportRpc).not.toHaveBeenCalled();
  });
});
