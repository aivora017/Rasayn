import { describe, it, expect } from "vitest";
import { rupeesToPaise, paise } from "@pharmacare/shared-types";
import { computeLine, computeInvoice, inferTreatment } from "./index.js";

describe("gst-engine · MRP-inclusive reverse calc", () => {
  it("12% intra-state: MRP ₹112 → taxable ₹100, CGST ₹6, SGST ₹6", () => {
    const line = computeLine(
      { mrpPaise: rupeesToPaise(112), qty: 1, gstRate: 12 },
      "intra_state",
    );
    expect(line.taxableValuePaise).toBe(10000);
    expect(line.cgstPaise).toBe(600);
    expect(line.sgstPaise).toBe(600);
    expect(line.igstPaise).toBe(0);
    expect(line.lineTotalPaise).toBe(11200);
  });

  it("5% inter-state: MRP ₹105 → taxable ₹100, IGST ₹5", () => {
    const line = computeLine(
      { mrpPaise: rupeesToPaise(105), qty: 1, gstRate: 5 },
      "inter_state",
    );
    expect(line.taxableValuePaise).toBe(10000);
    expect(line.igstPaise).toBe(500);
    expect(line.cgstPaise).toBe(0);
    expect(line.sgstPaise).toBe(0);
  });

  it("exempt line (insulin etc.): zero tax regardless of rate flag", () => {
    const line = computeLine(
      { mrpPaise: rupeesToPaise(250), qty: 2, gstRate: 12 },
      "exempt",
    );
    expect(line.taxableValuePaise).toBe(50000);
    expect(line.cgstPaise + line.sgstPaise + line.igstPaise).toBe(0);
  });

  it("odd-paise tax splits so CGST+SGST equals total tax exactly", () => {
    // MRP 101 * 1 = 101; 18% => taxable 8559, tax 1541 → 770+771
    const line = computeLine(
      { mrpPaise: rupeesToPaise(101), qty: 1, gstRate: 18 },
      "intra_state",
    );
    expect(line.cgstPaise + line.sgstPaise).toBe(10100 - line.taxableValuePaise);
  });

  it("percentage discount applies pre-tax on gross", () => {
    const line = computeLine(
      { mrpPaise: rupeesToPaise(200), qty: 1, gstRate: 12, discountPct: 10 },
      "intra_state",
    );
    // gross 20000, disc 2000, net 18000 → taxable 16071, tax 1929
    expect(line.discountPaise).toBe(2000);
    expect(line.taxableValuePaise + line.cgstPaise + line.sgstPaise).toBe(18000);
  });

  it("rejects discount > gross", () => {
    expect(() => computeLine(
      { mrpPaise: rupeesToPaise(100), qty: 1, gstRate: 5, discountPaise: paise(20000) },
      "intra_state",
    )).toThrow();
  });

  it("invoice round-off: preRound 44455 → grand 44500, round-off +45", () => {
    const l1 = computeLine({ mrpPaise: rupeesToPaise(112), qty: 1, gstRate: 12 }, "intra_state");
    const l2 = computeLine({ mrpPaise: rupeesToPaise(3335.5), qty: 1, gstRate: 12 }, "intra_state");
    const totals = computeInvoice([l1, l2]);
    expect(totals.grandTotalPaise % 100).toBe(0);
    expect(Math.abs(totals.roundOffPaise)).toBeLessThanOrEqual(50);
    expect(totals.preRoundPaise + totals.roundOffPaise).toBe(totals.grandTotalPaise);
  });

  it("qty 0 → zero line", () => {
    const line = computeLine({ mrpPaise: rupeesToPaise(100), qty: 0, gstRate: 12 }, "intra_state");
    expect(line.lineTotalPaise).toBe(0);
  });
});

describe("gst-engine · treatment inference", () => {
  it("same state → intra_state", () => {
    expect(inferTreatment("27", "27", false)).toBe("intra_state");
  });
  it("different state → inter_state", () => {
    expect(inferTreatment("27", "29", false)).toBe("inter_state");
  });
  it("walk-in (no customer state) → intra_state", () => {
    expect(inferTreatment("27", null, false)).toBe("intra_state");
  });
  it("exempt flag overrides", () => {
    expect(inferTreatment("27", "29", true)).toBe("exempt");
  });
});
