import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DPDPConsentScreen from "./DPDPConsentScreen";

vi.mock("../lib/ipc.js", () => ({
  dpdpListDsrRpc: vi.fn(async () => [
    { id: "r1", customerId: "c1", kind: "access" as const, receivedAt: "2026-04-25T10:00:00Z", status: "received" as const },
  ]),
  dpdpListConsentsRpc: vi.fn(async () => []),
  dpdpUpsertConsentRpc: vi.fn(async () => ({})),
  dpdpOpenDsrRpc: vi.fn(async () => ({})),
  dpdpUpdateDsrStatusRpc: vi.fn(async () => null),
}));

describe("DPDPConsentScreen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the header", () => {
    render(<DPDPConsentScreen />);
    expect(screen.getByRole("heading", { name: /DPDP Act/i })).toBeInTheDocument();
  });

  it("loads open DSR requests on mount", async () => {
    render(<DPDPConsentScreen />);
    await waitFor(() => {
      expect(screen.getByText("c1")).toBeInTheDocument();
      expect(screen.getByText("access")).toBeInTheDocument();
    });
  });

  it("shows the open-DSR form on the DSR tab", () => {
    render(<DPDPConsentScreen />);
    expect(screen.getByText(/Open new DSR/i)).toBeInTheDocument();
  });
});
