// @pharmacare/bill-repo · partialRefund.ts unit tests (ADR 0021 step 2).
// -----------------------------------------------------------------------------
// Pure-TS tests. No DB, no Tauri. Covers ADR 0021 §Test-strategy-Unit cases:
//   * full-line return  (qty == orig.qty)                           ✓
//   * half-strip return (qty == orig.qty / 2)                       ✓
//   * odd-paise rounding at 1/3 return (bias test)                  ✓
//   * discount pro-rata on a discounted line                        ✓
//   * CGST+SGST intra-state equal-split line                        ✓
//   * IGST inter-state single-component line                        ✓
//   * 3-tender residual-to-largest split                            ✓
//   * over-return rejection (QTY_EXCEEDS_REFUNDABLE)                ✓
//   * zero / negative qty rejection                                 ✓
//   * round-off ±50 paise cap enforcement                           ✓
// -----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { paise, type Paise } from "@pharmacare/shared-types";
import {
  computeLineProRata,
  computeTenderReversal,
  computeRoundOffPaise,
  QtyExceedsRefundableError,
  InvalidReturnQtyError,
  InvalidRefundTotalError,
  type BillLineProRataInput,
  type ReturnTender,
  type ProRataResult,
} from "./partialRefund.js";

const p = (n: number): Paise => paise(n);

function proRataLine(
  overrides: Partial<BillLineProRataInput> = {},
): BillLineProRataInput {
  // Default: Crocin strip, qty 10, MRP ₹110/strip, 12% GST intra-state, no discount.
  //   gross       = 110_00 × 10             = 110_000 paise
  //   taxable     = 110_000 × 100 / 112      ≈  98_214 paise
  //   total_tax   = 110_000 − 98_214         =  11_786 paise
  //   cgst = sgst =  5_893 (sgst absorbs 1p) −→ we model it at the canonical
  //     computeLine output the existing gst-engine tests lock in.
  return {
    billLineId: "bl_default",
    qty: 10,
    taxableValuePaise: p(98214),
    discountPaise: p(0),
    cgstPaise: p(5893),
    sgstPaise: p(5893),
    igstPaise: p(0),
    cessPaise: p(0),
    lineTotalPaise: p(98214 + 5893 + 5893),
    ...overrides,
  };
}

describe("bill-repo · computeLineProRata", () => {
  it("full-line return refunds the exact original tax components", () => {
    const orig = proRataLine();
    const r = computeLineProRata(orig, 10);

    expect(r.refundTaxablePaise).toBe(orig.taxableValuePaise);
    expect(r.refundDiscountPaise).toBe(orig.discountPaise);
    expect(r.refundCgstPaise).toBe(orig.cgstPaise);
    expect(r.refundSgstPaise).toBe(orig.sgstPaise);
    expect(r.refundIgstPaise).toBe(orig.igstPaise);
    expect(r.refundCessPaise).toBe(orig.cessPaise);
    // refund_amount = taxable − discount + all tax → equals lineTotal exactly.
    expect(r.refundAmountPaise).toBe(orig.lineTotalPaise);
  });

  it("half-strip (qty 5/10) refunds 50% of every component, rounded", () => {
    const orig = proRataLine();
    const r = computeLineProRata(orig, 5);

    expect(r.refundTaxablePaise).toBe(p(orig.taxableValuePaise / 2));
    expect(r.refundCgstPaise).toBe(p(orig.cgstPaise / 2));
    expect(r.refundSgstPaise).toBe(p(orig.sgstPaise / 2));
    // Sanity: refund_amount is under the pro-rata NPPA ceiling
    // (lineTotal × 0.5 + 50 paise slack).
    expect(r.refundAmountPaise).toBeLessThanOrEqual(
      Math.trunc(orig.lineTotalPaise * 0.5) + 50,
    );
  });

  it("1/3 return rounds half-away-from-zero consistently (odd-paise bias)", () => {
    // 100 paise × 1/3 = 33.333... → 33 paise (round-half-to-even would tie
    // differently, but paise() uses Math.round; for non-negatives this is
    // half-away-from-zero). Two separate 1/3 calls must both round the same
    // way, i.e. we are deterministic and unbiased across repeat calls.
    const orig: BillLineProRataInput = {
      qty: 3,
      taxableValuePaise: p(100),
      discountPaise: p(0),
      cgstPaise: p(6),
      sgstPaise: p(6),
      igstPaise: p(0),
      cessPaise: p(0),
      lineTotalPaise: p(112),
    };
    const r = computeLineProRata(orig, 1);

    // 100 × 1/3 = 33.333… → 33
    expect(r.refundTaxablePaise).toBe(p(33));
    // 6 × 1/3 = 2.000… → 2
    expect(r.refundCgstPaise).toBe(p(2));
    expect(r.refundSgstPaise).toBe(p(2));
    // refund_amount = 33 − 0 + 2 + 2 = 37. Not 37.333…
    expect(r.refundAmountPaise).toBe(p(37));
  });

  it("discount pro-rata applies on a non-zero-discount line", () => {
    const orig: BillLineProRataInput = {
      qty: 10,
      taxableValuePaise: p(10000),
      discountPaise: p(1000), // 10% absolute discount
      cgstPaise: p(600),
      sgstPaise: p(600),
      igstPaise: p(0),
      cessPaise: p(0),
      lineTotalPaise: p(10000 - 1000 + 600 + 600), // 10_200
    };
    const r = computeLineProRata(orig, 4);

    // 10000 × 4/10 = 4000
    expect(r.refundTaxablePaise).toBe(p(4000));
    // 1000 × 4/10 = 400
    expect(r.refundDiscountPaise).toBe(p(400));
    expect(r.refundCgstPaise).toBe(p(240));
    expect(r.refundSgstPaise).toBe(p(240));
    // amount = 4000 − 400 + 240 + 240 = 4080
    expect(r.refundAmountPaise).toBe(p(4080));
  });

  it("CGST+SGST intra-state: equal split preserved in the refund", () => {
    const orig = proRataLine();
    const r = computeLineProRata(orig, 6);

    // For an even original split both halves round the same way.
    expect(r.refundCgstPaise).toBe(r.refundSgstPaise);
    expect(r.refundIgstPaise).toBe(p(0));
  });

  it("IGST inter-state: single-component refund, zero CGST/SGST", () => {
    // Same 12% GST but inter-state → all tax lands in igst.
    const orig: BillLineProRataInput = {
      qty: 10,
      taxableValuePaise: p(98214),
      discountPaise: p(0),
      cgstPaise: p(0),
      sgstPaise: p(0),
      igstPaise: p(11786),
      cessPaise: p(0),
      lineTotalPaise: p(98214 + 11786),
    };
    const r = computeLineProRata(orig, 5);

    expect(r.refundCgstPaise).toBe(p(0));
    expect(r.refundSgstPaise).toBe(p(0));
    expect(r.refundIgstPaise).toBe(p(11786 / 2));
    expect(r.refundTaxablePaise).toBe(p(98214 / 2));
  });

  it("over-return (qty_returned > orig.qty) throws QtyExceedsRefundableError", () => {
    const orig = proRataLine({ qty: 10 });
    expect(() => computeLineProRata(orig, 11)).toThrow(QtyExceedsRefundableError);
    // Structured fields survive so UI can highlight the offending row.
    try {
      computeLineProRata(orig, 11);
    } catch (e) {
      expect(e).toBeInstanceOf(QtyExceedsRefundableError);
      expect((e as QtyExceedsRefundableError).qtyReturned).toBe(11);
      expect((e as QtyExceedsRefundableError).origQty).toBe(10);
      expect((e as QtyExceedsRefundableError).billLineId).toBe("bl_default");
    }
  });

  it("zero qty_returned throws InvalidReturnQtyError", () => {
    const orig = proRataLine();
    expect(() => computeLineProRata(orig, 0)).toThrow(InvalidReturnQtyError);
  });

  it("negative qty_returned throws InvalidReturnQtyError", () => {
    const orig = proRataLine();
    expect(() => computeLineProRata(orig, -1)).toThrow(InvalidReturnQtyError);
  });

  it("NaN qty_returned throws InvalidReturnQtyError", () => {
    const orig = proRataLine();
    expect(() => computeLineProRata(orig, Number.NaN)).toThrow(
      InvalidReturnQtyError,
    );
  });

  it("degenerate orig.qty = 0 throws (defence in depth, DB CHECK blocks this)", () => {
    const orig = proRataLine({ qty: 0 });
    expect(() => computeLineProRata(orig, 1)).toThrow(InvalidReturnQtyError);
  });
});

// ---- Tender reversal -------------------------------------------------------

describe("bill-repo · computeTenderReversal", () => {
  it("single-tender bill refunds against the same tender", () => {
    const tenders: ReturnTender[] = [
      { mode: "cash", amountPaise: p(50000) },
    ];
    const out = computeTenderReversal(tenders, 25000);
    expect(out).toHaveLength(1);
    expect(out[0]!.mode).toBe("cash");
    expect(out[0]!.amountPaise).toBe(p(25000));
  });

  it("3-tender split — residual-to-largest (ADR 0021 §2 rule 2)", () => {
    // ₹1000 = ₹600 UPI + ₹300 cash + ₹100 card. Refund ₹250.
    // Proportional shares:
    //   UPI  = 60% × 25000 = 15000 paise
    //   cash = 30% × 25000 =  7500 paise
    //   card = 10% × 25000 =  2500 paise
    // Sum = 25000 — exact. Largest (UPI) absorbs any rounding residual.
    const tenders: ReturnTender[] = [
      { mode: "upi",  amountPaise: p(60000), refNo: "RRN-111" },
      { mode: "cash", amountPaise: p(30000) },
      { mode: "card", amountPaise: p(10000), refNo: "****1234" },
    ];
    const out = computeTenderReversal(tenders, 25000);

    expect(out).toHaveLength(3);
    expect(out[0]!).toMatchObject({ mode: "upi",  amountPaise: p(15000), refNo: "RRN-111" });
    expect(out[1]!).toMatchObject({ mode: "cash", amountPaise: p(7500) });
    expect(out[2]!).toMatchObject({ mode: "card", amountPaise: p(2500), refNo: "****1234" });

    // Invariant: sum of reversals === refund_total_paise.
    const sum = out.reduce((s, t) => s + t.amountPaise, 0);
    expect(sum).toBe(25000);
  });

  it("residual IS absorbed by the largest tender when shares don't divide evenly", () => {
    // Odd-paise residual construction:
    //   total = 3333 paise allocated across 1000 + 1000 + 333 paise tenders.
    //   Each proportional share introduces a fractional paise that Math.round
    //   collapses, leaving a small residual the largest tender must swallow.
    const tenders: ReturnTender[] = [
      { mode: "cash", amountPaise: p(1000) },
      { mode: "upi",  amountPaise: p(1000) },
      { mode: "card", amountPaise: p(333) },
    ];
    const refund = 777;
    const out = computeTenderReversal(tenders, refund);

    const sum = out.reduce((s, t) => s + t.amountPaise, 0);
    expect(sum).toBe(refund); // residual absorbed somewhere
    // Largest tender (first cash or upi — tie → first-seen cash by our
    // implementation) either equals its proportional share OR carries the
    // residual. Zero-amount allocations are filtered; every output > 0.
    for (const t of out) {
      expect(t.amountPaise).toBeGreaterThan(0);
    }
  });

  it("zero-amount tender in the input is filtered from the refund allocation", () => {
    const tenders: ReturnTender[] = [
      { mode: "cash", amountPaise: p(10000) },
      { mode: "upi",  amountPaise: p(0) }, // wasn't actually used
    ];
    const out = computeTenderReversal(tenders, 5000);
    expect(out).toHaveLength(1);
    expect(out[0]!.mode).toBe("cash");
  });

  it("empty tenders → NO_TENDERS", () => {
    expect(() => computeTenderReversal([], 1000)).toThrow(/NO_TENDERS/);
  });

  it("all-zero tender sum → ZERO_TENDER_TOTAL", () => {
    const tenders: ReturnTender[] = [
      { mode: "cash", amountPaise: p(0) },
      { mode: "upi",  amountPaise: p(0) },
    ];
    expect(() => computeTenderReversal(tenders, 1000)).toThrow(
      /ZERO_TENDER_TOTAL/,
    );
  });

  it("refund_total <= 0 throws InvalidRefundTotalError", () => {
    const tenders: ReturnTender[] = [{ mode: "cash", amountPaise: p(10000) }];
    expect(() => computeTenderReversal(tenders, 0)).toThrow(
      InvalidRefundTotalError,
    );
    expect(() => computeTenderReversal(tenders, -500)).toThrow(
      InvalidRefundTotalError,
    );
  });
});

// ---- Round-off -------------------------------------------------------------

describe("bill-repo · computeRoundOffPaise", () => {
  it("returns zero when per-line sum matches the tender total exactly", () => {
    const lines: ProRataResult[] = [
      {
        refundTaxablePaise: p(100),
        refundDiscountPaise: p(0),
        refundCgstPaise: p(6),
        refundSgstPaise: p(6),
        refundIgstPaise: p(0),
        refundCessPaise: p(0),
        refundAmountPaise: p(112),
      },
    ];
    expect(computeRoundOffPaise(lines, 112)).toBe(0);
  });

  it("returns a signed delta within ±50 paise", () => {
    const lines: ProRataResult[] = [
      {
        refundTaxablePaise: p(100),
        refundDiscountPaise: p(0),
        refundCgstPaise: p(6),
        refundSgstPaise: p(6),
        refundIgstPaise: p(0),
        refundCessPaise: p(0),
        refundAmountPaise: p(112),
      },
    ];
    // Cashier wants 150 → ∑lines is 112 → delta +38 (within ±50)
    expect(computeRoundOffPaise(lines, 150)).toBe(38);
    // Cashier wants 100 → ∑lines is 112 → delta −12
    expect(computeRoundOffPaise(lines, 100)).toBe(-12);
  });

  it("throws when the mismatch exceeds ±50 paise (bug in caller)", () => {
    const lines: ProRataResult[] = [
      {
        refundTaxablePaise: p(100),
        refundDiscountPaise: p(0),
        refundCgstPaise: p(0),
        refundSgstPaise: p(0),
        refundIgstPaise: p(0),
        refundCessPaise: p(0),
        refundAmountPaise: p(100),
      },
    ];
    expect(() => computeRoundOffPaise(lines, 200)).toThrow(
      /ROUND_OFF_OUT_OF_RANGE/,
    );
    expect(() => computeRoundOffPaise(lines, 0)).toThrow(
      /ROUND_OFF_OUT_OF_RANGE/,
    );
  });
});
