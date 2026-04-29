import { describe, it, expect } from "vitest";
import { buildHandover, type ShiftHandoverInput } from "./index.js";

const baseInput: ShiftHandoverInput = {
  shiftId: "shift_abc",
  shopName: "Jagannath Pharmacy",
  cashierName: "Sourav",
  nextCashierName: "Aarti",
  openedAtIso: "2026-04-29T09:00:00Z",
  closedAtIso: "2026-04-29T21:00:00Z",
  billCount: 87,
  totalSalesPaise: 4_50_000,        // ₹4,500
  totalReturnsPaise: 12_000,        // ₹120
  variancePaise: -3_000,            // ₹30 short
  varianceApproved: true,
  topSellers: [
    { productName: "Paracetamol 500mg", qty: 120, revenuePaise: 18_000 },
    { productName: "Crocin Advance",     qty: 80,  revenuePaise: 22_400 },
  ],
  expiredDiscarded: [
    { productName: "Insulin (NovoMix)", batchNo: "B12345", qty: 2, lossPaise: 80_000 },
  ],
  complaints: [
    { summary: "Wrong batch given", resolved: true },
    { customerName: "Mr Sharma", summary: "MRP charged extra", resolved: false },
  ],
  reorderHints: [
    { productName: "Paracetamol 500mg", daysOfStockLeft: 2 },
  ],
  note: "Cold chain probe needs replacement",
};

describe("buildHandover", () => {
  it("headline summarises shift", () => {
    const out = buildHandover(baseInput);
    expect(out.headline).toContain("Sourav");
    expect(out.headline).toContain("87 bills");
    expect(out.headline).toContain("shortage");
  });

  it("body includes all sections", () => {
    const out = buildHandover(baseInput);
    expect(out.body).toContain("Top sellers");
    expect(out.body).toContain("Expired discarded");
    expect(out.body).toContain("Complaints");
    expect(out.body).toContain("Reorder before next shift");
    expect(out.body).toContain("Cold chain probe");
  });

  it("body includes both cashier handoff names", () => {
    const out = buildHandover(baseInput);
    expect(out.body).toContain("Sourav → Aarti");
  });

  it("WhatsApp body uses emojis + is short", () => {
    const out = buildHandover(baseInput);
    expect(out.whatsappBody).toContain("📊");
    expect(out.whatsappBody.split("\n").length).toBeLessThanOrEqual(8);
  });

  it("variance shown signed with rupee sign", () => {
    const out = buildHandover(baseInput);
    expect(out.body).toContain("-₹30.00");
  });

  it("exact variance shown as ₹0.00", () => {
    const out = buildHandover({ ...baseInput, variancePaise: 0 });
    expect(out.body).toContain("₹0.00");
    expect(out.headline).toContain("exact");
  });

  it("overage variance has + sign", () => {
    const out = buildHandover({ ...baseInput, variancePaise: 5_000 });
    expect(out.headline).toContain("overage");
    expect(out.body).toContain("+₹50.00");
  });

  it("receipt body fits 32-col paper", () => {
    const out = buildHandover(baseInput);
    for (const line of out.receiptBytes.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(32);
    }
  });

  it("skips empty sections in body", () => {
    const out = buildHandover({
      ...baseInput,
      topSellers: [],
      expiredDiscarded: [],
      complaints: [],
      reorderHints: [],
      note: undefined,
    });
    expect(out.body).not.toContain("Top sellers");
    expect(out.body).not.toContain("Expired discarded");
  });

  it("complaints show resolved / open status", () => {
    const out = buildHandover(baseInput);
    expect(out.body).toContain("✔ resolved");
    expect(out.body).toContain("✗ open");
  });
});
