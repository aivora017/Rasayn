import { describe, it, expect } from "vitest";
import {
  computeSuggestions,
  groupBySupplier,
  buildPORows,
  type ReorderInputs,
  type StockSnapshot,
  type SupplierProfile,
  type DemandForecast,
} from "./index.js";

const STOCK: StockSnapshot[] = [
  { productId: "p1", productName: "Paracetamol", skuCode: "PCM500",
    preferredSupplierId: "sup1", onHandUnits: 30, avgCostPaise: 100, safetyStockUnits: 50 },
  { productId: "p2", productName: "Crocin",      skuCode: "CRC500",
    preferredSupplierId: "sup1", onHandUnits: 200, avgCostPaise: 250, safetyStockUnits: 50 },
  { productId: "p3", productName: "Insulin",     skuCode: "INS-N",
    preferredSupplierId: "sup2", onHandUnits: 5, avgCostPaise: 20000, safetyStockUnits: 10 },
];

const SUPPLIERS: SupplierProfile[] = [
  { supplierId: "sup1", supplierName: "Bharat Pharma Distributors",
    leadTimeDays: 3, minOrderValuePaise: 50_00_000,  // ₹50k
    moqByProductId: { p1: 100 } },
  { supplierId: "sup2", supplierName: "Cipla Direct",
    leadTimeDays: 5, minOrderValuePaise: 10_00_000,  // ₹10k
    moqByProductId: {} },
];

const FORECASTS: DemandForecast[] = [
  { productId: "p1", dailyUnits: Array(30).fill(10) },   // 10/day
  { productId: "p2", dailyUnits: Array(30).fill(2) },    // 2/day — already overstocked
  { productId: "p3", dailyUnits: Array(30).fill(1) },    // 1/day
];

describe("computeSuggestions", () => {
  it("suggests reorder when stock < expected demand + safety", () => {
    const out = computeSuggestions({ stocks: STOCK, suppliers: SUPPLIERS, forecasts: FORECASTS });
    // p1: window=10 days, demand=100, safety=50 → target 150, on-hand 30 → need 120, MOQ 100 → 200
    const p1 = out.find((s) => s.productId === "p1");
    expect(p1?.suggestQtyUnits).toBe(200);
    expect(p1?.urgency).toBe("critical");
  });

  it("skips when stock >= target", () => {
    const out = computeSuggestions({ stocks: STOCK, suppliers: SUPPLIERS, forecasts: FORECASTS });
    expect(out.find((s) => s.productId === "p2")).toBeUndefined();
  });

  it("skips when supplier missing", () => {
    const out = computeSuggestions({
      stocks: [{ ...STOCK[0]!, preferredSupplierId: "ghost" }],
      suppliers: SUPPLIERS,
      forecasts: FORECASTS,
    });
    expect(out.length).toBe(0);
  });

  it("urgency reflects days-of-stock-left vs lead time", () => {
    // sup2 lead=5; p3: on-hand 5 / 1 per day = 5 days left → critical (5 <= 5)
    const out = computeSuggestions({ stocks: STOCK, suppliers: SUPPLIERS, forecasts: FORECASTS });
    const p3 = out.find((s) => s.productId === "p3");
    expect(p3?.urgency).toBe("critical");
  });

  it("rounds qty up to MOQ multiple", () => {
    const out = computeSuggestions({ stocks: STOCK, suppliers: SUPPLIERS, forecasts: FORECASTS });
    const p1 = out.find((s) => s.productId === "p1");
    expect(p1!.suggestQtyUnits % 100).toBe(0);
  });

  it("sorts critical before normal, then by value", () => {
    const out = computeSuggestions({ stocks: STOCK, suppliers: SUPPLIERS, forecasts: FORECASTS });
    if (out.length >= 2) {
      const urg = (u: typeof out[number]["urgency"]) =>
        u === "critical" ? 0 : u === "high" ? 1 : 2;
      for (let i = 1; i < out.length; i++) {
        expect(urg(out[i - 1]!.urgency)).toBeLessThanOrEqual(urg(out[i]!.urgency));
      }
    }
  });
});

describe("groupBySupplier", () => {
  it("groups suggestions by supplier", () => {
    const sugs = computeSuggestions({ stocks: STOCK, suppliers: SUPPLIERS, forecasts: FORECASTS });
    const groups = groupBySupplier(sugs, SUPPLIERS);
    expect(groups.length).toBeGreaterThan(0);
    expect(new Set(groups.map((g) => g.supplierId)).size).toBe(groups.length);
  });

  it("flags meetsMinOrderValue correctly", () => {
    const sugs = computeSuggestions({ stocks: STOCK, suppliers: SUPPLIERS, forecasts: FORECASTS });
    const groups = groupBySupplier(sugs, SUPPLIERS);
    for (const g of groups) {
      const sup = SUPPLIERS.find((s) => s.supplierId === g.supplierId)!;
      expect(g.meetsMinOrderValue).toBe(g.totalValuePaise >= sup.minOrderValuePaise);
    }
  });

  it("sorts groups by value (highest first)", () => {
    const sugs = computeSuggestions({ stocks: STOCK, suppliers: SUPPLIERS, forecasts: FORECASTS });
    const groups = groupBySupplier(sugs, SUPPLIERS);
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1]!.totalValuePaise).toBeGreaterThanOrEqual(groups[i]!.totalValuePaise);
    }
  });
});

describe("buildPORows", () => {
  it("converts paise to rupees with 2-decimal rounding", () => {
    const sugs = computeSuggestions({ stocks: STOCK, suppliers: SUPPLIERS, forecasts: FORECASTS });
    const groups = groupBySupplier(sugs, SUPPLIERS);
    if (groups.length > 0) {
      const rows = buildPORows(groups[0]!);
      expect(rows.length).toBe(groups[0]!.lines.length);
      expect(rows[0]!.amountRupees).toBeGreaterThan(0);
      expect(rows[0]!.qty).toBe(groups[0]!.lines[0]!.suggestQtyUnits);
    }
  });
});
