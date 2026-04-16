import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rupeesToPaise, paise } from "@pharmacare/shared-types";
import {
  computeLine, computeInvoice, inferTreatment,
  validateLine, computeLineChecked,
  BillValidationError,
  type LineInput, type LineTax, type InvoiceTotals,
} from "./index.js";
import { referenceComputeLine, referenceComputeInvoice } from "./reference.js";

// ─── MRP-inclusive reverse-calc (hand-authored canonical cases) ──────────
describe("gst-engine · MRP-inclusive reverse calc", () => {
  it("12% intra-state: MRP Rs112 → taxable Rs100, CGST Rs6, SGST Rs6", () => {
    const line = computeLine({ mrpPaise: rupeesToPaise(112), qty: 1, gstRate: 12 }, "intra_state");
    expect(line.taxableValuePaise).toBe(10000);
    expect(line.cgstPaise).toBe(600);
    expect(line.sgstPaise).toBe(600);
    expect(line.igstPaise).toBe(0);
    expect(line.lineTotalPaise).toBe(11200);
  });

  it("5% inter-state: MRP Rs105 → taxable Rs100, IGST Rs5", () => {
    const line = computeLine({ mrpPaise: rupeesToPaise(105), qty: 1, gstRate: 5 }, "inter_state");
    expect(line.taxableValuePaise).toBe(10000);
    expect(line.igstPaise).toBe(500);
    expect(line.cgstPaise).toBe(0);
    expect(line.sgstPaise).toBe(0);
  });

  it("exempt line (insulin etc.): zero tax regardless of rate flag", () => {
    const line = computeLine({ mrpPaise: rupeesToPaise(250), qty: 2, gstRate: 12 }, "exempt");
    expect(line.taxableValuePaise).toBe(50000);
    expect(line.cgstPaise + line.sgstPaise + line.igstPaise).toBe(0);
  });

  it("odd-paise tax splits so CGST+SGST equals total tax exactly", () => {
    // MRP 101 * 1 = 101; 18% => taxable 8559, tax 1541 → 771+770
    const line = computeLine({ mrpPaise: rupeesToPaise(101), qty: 1, gstRate: 18 }, "intra_state");
    expect(line.cgstPaise + line.sgstPaise).toBe(10100 - line.taxableValuePaise);
  });

  it("percentage discount applies pre-tax on gross", () => {
    const line = computeLine(
      { mrpPaise: rupeesToPaise(200), qty: 1, gstRate: 12, discountPct: 10 },
      "intra_state",
    );
    expect(line.discountPaise).toBe(2000);
    expect(line.taxableValuePaise + line.cgstPaise + line.sgstPaise).toBe(18000);
  });

  it("rejects discount > gross", () => {
    expect(() => computeLine(
      { mrpPaise: rupeesToPaise(100), qty: 1, gstRate: 5, discountPaise: paise(20000) },
      "intra_state",
    )).toThrow();
  });

  it("invoice round-off preserves sum and caps at ±50 paise", () => {
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

// ─── Treatment inference ────────────────────────────────────────────────
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

// ─── A4: validation + NPPA + reason codes ───────────────────────────────
describe("gst-engine · validateLine (A4)", () => {
  const ok: LineInput = { mrpPaise: rupeesToPaise(100), qty: 1, gstRate: 12 };

  it("passes a clean line", () => {
    expect(validateLine(ok).ok).toBe(true);
  });

  it("flags non-positive MRP", () => {
    const r = validateLine({ ...ok, mrpPaise: paise(0) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe("MRP_NON_POSITIVE");
  });

  it("flags negative qty", () => {
    const r = validateLine({ ...ok, qty: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe("NEGATIVE_QTY");
  });

  it("flags unsupported GST rate", () => {
    const r = validateLine({ ...ok, gstRate: 7 as never });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe("GST_RATE_INVALID");
  });

  it("flags discount pct > 100", () => {
    const r = validateLine({ ...ok, discountPct: 150 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe("DISCOUNT_PCT_OUT_OF_RANGE");
  });

  it("flags absolute discount > gross", () => {
    const r = validateLine({ ...ok, discountPaise: paise(20000) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasonCode).toBe("DISCOUNT_EXCEEDS_GROSS");
  });

  it("flags NPPA cap breach with context", () => {
    const r = validateLine(
      { ...ok, mrpPaise: rupeesToPaise(150) },
      { nppaMaxMrpPaise: rupeesToPaise(140), productName: "Paracetamol 500mg", batchNo: "B001" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reasonCode).toBe("NPPA_CAP_EXCEEDED");
      expect(r.message).toContain("150.00");
      expect(r.message).toContain("140.00");
      expect(r.message).toContain("Paracetamol 500mg");
      expect(r.detail?.batchNo).toBe("B001");
    }
  });

  it("NPPA cap null → no breach", () => {
    const r = validateLine({ ...ok, mrpPaise: rupeesToPaise(10000) }, { nppaMaxMrpPaise: null });
    expect(r.ok).toBe(true);
  });

  it("NPPA cap equal to MRP → no breach (inclusive upper bound)", () => {
    const r = validateLine(
      { ...ok, mrpPaise: rupeesToPaise(140) },
      { nppaMaxMrpPaise: rupeesToPaise(140) },
    );
    expect(r.ok).toBe(true);
  });

  it("flags expired batch", () => {
    const r = validateLine(ok, { isExpired: true, batchNo: "BX-2024" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reasonCode).toBe("EXPIRED_BATCH");
      expect(r.message).toContain("BX-2024");
    }
  });
});

describe("gst-engine · computeLineChecked (A4)", () => {
  it("throws BillValidationError with reasonCode on NPPA breach", () => {
    expect.assertions(3);
    try {
      computeLineChecked(
        { mrpPaise: rupeesToPaise(200), qty: 1, gstRate: 12 },
        "intra_state",
        { nppaMaxMrpPaise: rupeesToPaise(150), productName: "Atenolol 50mg" },
      );
    } catch (e) {
      expect(e).toBeInstanceOf(BillValidationError);
      const err = e as BillValidationError;
      expect(err.reasonCode).toBe("NPPA_CAP_EXCEEDED");
      expect(err.detail?.productName).toBe("Atenolol 50mg");
    }
  });

  it("computes successfully when validation passes", () => {
    const line = computeLineChecked(
      { mrpPaise: rupeesToPaise(112), qty: 1, gstRate: 12 },
      "intra_state",
      { nppaMaxMrpPaise: rupeesToPaise(150) },
    );
    expect(line.taxableValuePaise).toBe(10000);
  });
});

// ─── A4: Golden regression suite (100 bills) ─────────────────────────────
interface GoldenBill {
  id: string;
  description: string;
  treatment: "intra_state" | "inter_state" | "exempt" | "nil_rated";
  lines: LineInput[];
  expectedLines: LineTax[];
  expectedInvoice: InvoiceTotals;
}
interface GoldenDoc {
  version: string;
  generatedAt: string;
  count: number;
  bills: GoldenBill[];
}

function loadGolden(): GoldenDoc {
  const here = dirname(fileURLToPath(import.meta.url));
  const p = join(here, "..", "fixtures", "golden-bills.json");
  return JSON.parse(readFileSync(p, "utf8")) as GoldenDoc;
}

describe("gst-engine · golden regression suite (100 bills)", () => {
  const doc = loadGolden();

  it("fixture has 100 bills", () => {
    expect(doc.count).toBe(100);
    expect(doc.bills.length).toBe(100);
  });

  it.each(loadGolden().bills.map((b) => [b.id, b] as const))(
    "%s: production matches expected to paisa",
    (_id, bill) => {
      const got = bill.lines.map((l) => computeLine(l, bill.treatment));
      for (let i = 0; i < got.length; i++) {
        expect(got[i]).toEqual(bill.expectedLines[i]);
      }
      const inv = computeInvoice(got);
      expect(inv).toEqual(bill.expectedInvoice);
    },
  );

  it.each(loadGolden().bills.map((b) => [b.id, b] as const))(
    "%s: reference (BigInt) matches production",
    (_id, bill) => {
      const prod = bill.lines.map((l) => computeLine(l, bill.treatment));
      const ref = bill.lines.map((l) => referenceComputeLine(l, bill.treatment));
      for (let i = 0; i < prod.length; i++) {
        expect(ref[i]).toEqual(prod[i]);
      }
      expect(referenceComputeInvoice(ref)).toEqual(computeInvoice(prod));
    },
  );
});

// ─── A4: arithmetic invariants (never drift) ────────────────────────────
describe("gst-engine · invariants", () => {
  const doc = loadGolden();

  it.each(doc.bills.map((b) => [b.id, b] as const))(
    "%s: taxable + all taxes = lineTotal per line",
    (_id, bill) => {
      const got = bill.lines.map((l) => computeLine(l, bill.treatment));
      for (const l of got) {
        expect(l.taxableValuePaise + l.cgstPaise + l.sgstPaise + l.igstPaise).toBe(l.lineTotalPaise);
      }
    },
  );

  it("cgst + sgst = total tax per intra-state line", () => {
    for (const b of doc.bills.filter((x) => x.treatment === "intra_state")) {
      for (const l of b.expectedLines) {
        const totalTax = l.grossPaise - l.discountPaise - l.taxableValuePaise;
        expect(l.cgstPaise + l.sgstPaise).toBe(totalTax);
        expect(l.igstPaise).toBe(0);
      }
    }
  });

  it("inter-state lines carry only IGST", () => {
    for (const b of doc.bills.filter((x) => x.treatment === "inter_state")) {
      for (const l of b.expectedLines) {
        expect(l.cgstPaise).toBe(0);
        expect(l.sgstPaise).toBe(0);
      }
    }
  });

  it("exempt lines carry no tax at all", () => {
    for (const b of doc.bills.filter((x) => x.treatment === "exempt")) {
      for (const l of b.expectedLines) {
        expect(l.cgstPaise).toBe(0);
        expect(l.sgstPaise).toBe(0);
        expect(l.igstPaise).toBe(0);
      }
    }
  });

  it("round-off bounded to ±50 paise on every bill", () => {
    for (const b of doc.bills) {
      expect(Math.abs(b.expectedInvoice.roundOffPaise)).toBeLessThanOrEqual(50);
      expect(b.expectedInvoice.grandTotalPaise % 100).toBe(0);
      expect(b.expectedInvoice.preRoundPaise + b.expectedInvoice.roundOffPaise)
        .toBe(b.expectedInvoice.grandTotalPaise);
    }
  });
});
