import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import MultiStoreScreen from "./MultiStoreScreen";

vi.mock("../lib/ipc.js", () => ({
  shopsListRpc: vi.fn(async () => [
    { id: "shop_main", name: "Jagannath Pharmacy" },
    { id: "shop_branch_2", name: "Branch 2 Kalyan East" },
  ]),
  shopsInventorySummaryRpc: vi.fn(async () => [
    { shopId: "shop_main",     shopName: "Jagannath Pharmacy",      productCount: 12, batchCount: 24, totalUnits: 1450 },
    { shopId: "shop_branch_2", shopName: "Branch 2 Kalyan East",    productCount: 8,  batchCount: 16, totalUnits: 980 },
  ]),
  batchesListByShopRpc: vi.fn(async () => [
    { shopId: "shop_main", shopName: "Jagannath Pharmacy", productId: "p1", productName: "Paracetamol 500mg", batchId: "b1", batchNo: "PARA-2603", expiryDate: "2027-03-31", qtyOnHand: 100 },
  ]),
}));

describe("MultiStoreScreen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the header", async () => {
    render(<MultiStoreScreen />);
    expect(await screen.findByRole("heading", { name: /Multi-Store Inventory/i })).toBeInTheDocument();
  });

  it("loads shop summary on mount and rolls up totals", async () => {
    render(<MultiStoreScreen />);
    await waitFor(() => {
      expect(screen.getByText("Jagannath Pharmacy")).toBeInTheDocument();
      expect(screen.getByText("Branch 2 Kalyan East")).toBeInTheDocument();
      // 1450 + 980 = 2430 — the header rolls up totals
      expect(screen.getByText(/2,430 units total/i)).toBeInTheDocument();
    });
  });

  it("drills down into a shop's batches", async () => {
    render(<MultiStoreScreen />);
    await waitFor(() => {
      expect(screen.getByText("PARA-2603")).toBeInTheDocument();
    });
  });
});
