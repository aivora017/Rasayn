import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ColdChainScreen from "./ColdChainScreen";

vi.mock("../lib/ipc.js", () => ({
  coldChainListSensorsRpc: vi.fn(async () => [
    { id: "fridge_01", shopId: "shop_main", bleMac: "AA:BB:CC:00:00:01", label: "Vaccine fridge", minSafeC: 2, maxSafeC: 8, installedAt: "2026-04-30T00:00:00Z" },
  ]),
  coldChainListExcursionsRpc: vi.fn(async () => []),
  coldChainUpsertSensorRpc: vi.fn(async () => ({})),
  coldChainLogReadingRpc: vi.fn(async () => 1),
  coldChainCloseExcursionRpc: vi.fn(async () => null),
}));

describe("ColdChainScreen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the header", async () => {
    render(<ColdChainScreen />);
    expect(await screen.findByRole("heading", { name: /Cold-Chain/i })).toBeInTheDocument();
  });

  it("loads paired sensors on mount", async () => {
    render(<ColdChainScreen />);
    await waitFor(() => {
      expect(screen.getByText("Vaccine fridge")).toBeInTheDocument();
    });
  });

  it("shows the all-clear message when no excursions", async () => {
    render(<ColdChainScreen />);
    await waitFor(() => {
      expect(screen.getByText(/All sensors within safe range/i)).toBeInTheDocument();
    });
  });
});
