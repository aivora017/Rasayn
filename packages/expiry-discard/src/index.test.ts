import { describe, it, expect } from "vitest";
import {
  buildDiscardEntry,
  buildRegister,
  findExpired,
  findExpiring,
  toCsv,
  type ExpiredBatch,
} from "./index.js";

const otc: ExpiredBatch = {
  batchId: "b1", productId: "p1", productName: "Paracetamol 500mg",
  schedule: "OTC", batchNo: "B-OTC-001", expiryDate: "2025-12-31",
  qty: 100, avgCostPaise: 100, mrpPaise: 200,
};
const schedX: ExpiredBatch = {
  batchId: "b2", productId: "p2", productName: "Methadone",
  schedule: "X", batchNo: "B-X-001", expiryDate: "2025-12-31",
  qty: 10, avgCostPaise: 5_000, mrpPaise: 8_000,
};
const ndps: ExpiredBatch = {
  batchId: "b3", productId: "p3", productName: "Morphine",
  schedule: "NDPS", batchNo: "B-NDPS-001", expiryDate: "2025-12-31",
  qty: 5, avgCostPaise: 10_000, mrpPaise: 15_000,
};

describe("buildDiscardEntry", () => {
  it("computes loss for OTC", () => {
    const e = buildDiscardEntry(otc);
    expect(e.lossPaise).toBe(10_000);
    expect(e.mrpForgonePaise).toBe(20_000);
    expect(e.requiresFormD).toBe(false);
    expect(e.destructionMethod).toBe("deface_then_dispose");
  });

  it("flags Schedule X for Form D + witness + incinerate", () => {
    const e = buildDiscardEntry(schedX);
    expect(e.requiresFormD).toBe(true);
    expect(e.requiresWitness).toBe(true);
    expect(e.destructionMethod).toBe("incinerate");
  });

  it("flags NDPS the same way", () => {
    const e = buildDiscardEntry(ndps);
    expect(e.requiresFormD).toBe(true);
    expect(e.destructionMethod).toBe("incinerate");
  });

  it("attaches witness name + destroyed_at when provided", () => {
    const e = buildDiscardEntry(schedX, {
      destroyedAtIso: "2026-04-29T15:00:00Z",
      witnessName: "Drug Inspector Patil",
    });
    expect(e.witnessName).toBe("Drug Inspector Patil");
    expect(e.destroyedAtIso).toBe("2026-04-29T15:00:00Z");
  });
});

describe("buildRegister", () => {
  it("rolls up totals + per-schedule counts", () => {
    const reg = buildRegister([otc, schedX, ndps], "2026-04-01T00:00:00Z", "2026-04-30T23:59:59Z");
    expect(reg.entries.length).toBe(3);
    expect(reg.totalLossPaise).toBe(10_000 + 50_000 + 50_000);
    expect(reg.otcCount).toBe(1);
    expect(reg.schedXCount).toBe(1);
    expect(reg.ndpsCount).toBe(1);
  });
});

describe("findExpired / findExpiring", () => {
  const batches = [
    { id: "b1", productId: "p1", batchNo: "X1", expiryDate: "2025-12-31", qty: 10 },
    { id: "b2", productId: "p2", batchNo: "X2", expiryDate: "2026-05-15", qty: 5 },
    { id: "b3", productId: "p3", batchNo: "X3", expiryDate: "2027-01-01", qty: 20 },
    { id: "b4", productId: "p4", batchNo: "X4", expiryDate: "2025-11-01", qty: 0 },  // already empty
  ];

  it("finds expired batches with qty>0 only", () => {
    const out = findExpired(batches, "2026-04-29");
    expect(out.length).toBe(1);
    expect(out[0]?.id).toBe("b1");
  });

  it("finds expiring within window, sorted ascending", () => {
    const out = findExpiring(batches, "2026-04-29", 30);
    expect(out.length).toBe(1);
    expect(out[0]?.id).toBe("b2");
    expect(out[0]?.daysUntilExpiry).toBeGreaterThanOrEqual(0);
  });

  it("excludes batches expiring outside window", () => {
    const out = findExpiring(batches, "2026-04-29", 7);
    expect(out.length).toBe(0);
  });
});

describe("toCsv", () => {
  it("emits header + one row per entry", () => {
    const reg = buildRegister([otc, schedX], "2026-04-01T00:00:00Z", "2026-04-30T23:59:59Z");
    const csv = toCsv(reg);
    const lines = csv.split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("batch_id");
    expect(lines[1]).toContain("Paracetamol 500mg");
    expect(lines[2]).toContain("Methadone");
  });

  it("escapes commas in product names", () => {
    const tricky: ExpiredBatch = {
      ...otc,
      productName: "Drug, with comma",
    };
    const csv = toCsv(buildRegister([tricky], "2026-04-01T00:00:00Z", "2026-04-30T23:59:59Z"));
    expect(csv).toContain('"Drug, with comma"');
  });

  it("loss in CSV is rupees not paise", () => {
    const reg = buildRegister([otc], "2026-04-01T00:00:00Z", "2026-04-30T23:59:59Z");
    const csv = toCsv(reg);
    expect(csv).toContain(",100.00,");  // 10_000 paise = ₹100.00
  });
});
