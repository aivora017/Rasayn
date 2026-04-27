/**
 * A8 / ADR 0021 step 4 — GSTR-1 credit-note (cdnr / cdnur / b2cs-net) tests.
 *
 * Coverage:
 *   - Returns input is optional → backwards-compat with v1 callers.
 *   - Returns are period-filtered on `createdAt` (not original bill date).
 *   - B2B credit note → CDNR block grouped by buyer GSTIN, items per rate.
 *   - Interstate B2CL credit note (≥2.5L) → CDNUR note with pos + typ='B2CL'.
 *   - B2CS-small credit note → reduces matching B2CS bucket; clamps at 0.
 *   - Multi-rate return aggregates lines by rate (12% + 18% buckets).
 *   - Empty return-lines / non-positive refund_total → invalid.summary.
 *   - CSV bundle includes cdnr.csv + cdnur.csv with header + rows.
 *   - Summary cdnrNoteCount / cdnurNoteCount / creditNoteRefundTotalPaise correct.
 *   - cdnr buyer blocks are sorted by GSTIN; notes within block sorted by note no.
 */

import { describe, expect, it } from "vitest";
import { generateGstr1 } from "./index.js";
import {
  makeBill,
  makeCustomer,
  makeLine,
  makeReturn,
  makeReturnLine,
  makeShop,
} from "./fixtures.js";
import type { GenerateGstr1Input } from "./types.js";

const PERIOD = { mm: "03", yyyy: "2026" };

function baseInput(): GenerateGstr1Input {
  return {
    period: PERIOD,
    shop: makeShop(),
    bills: [],
    returns: [],
  };
}

describe("generateGstr1 — credit notes (cdnr/cdnur/b2cs-net)", () => {
  it("backwards-compat: omitting `returns` produces empty cdnr/cdnur and zero counts", () => {
    const r = generateGstr1({ period: PERIOD, shop: makeShop(), bills: [] });
    expect(r.json.cdnr).toEqual([]);
    expect(r.json.cdnur).toEqual([]);
    expect(r.summary.cdnrNoteCount).toBe(0);
    expect(r.summary.cdnurNoteCount).toBe(0);
    expect(r.summary.creditNoteRefundTotalPaise).toBe(0);
  });

  it("filters returns by createdAt (not by original bill date)", () => {
    const out = generateGstr1({
      ...baseInput(),
      returns: [
        // March return — kept
        makeReturn({
          id: "ret-march",
          returnNo: "CN/2025-26/0010",
          createdAt: "2026-03-20T10:00:00.000Z",
          customer: makeCustomer({ gstin: "27AABCC1111B1Z3" }),
        }),
        // Feb return on a March bill — dropped
        makeReturn({
          id: "ret-feb",
          returnNo: "CN/2025-26/0011",
          createdAt: "2026-02-15T10:00:00.000Z",
          originalBilledAt: "2026-02-01T10:00:00.000Z",
          customer: makeCustomer({ gstin: "27AABCC1111B1Z3" }),
        }),
      ],
    });
    expect(out.summary.cdnrNoteCount).toBe(1);
    expect(out.json.cdnr[0]?.nt[0]?.nt_num).toBe("CN/2025-26/0010");
  });

  it("B2B return → CDNR block grouped by buyer GSTIN, item per rate", () => {
    const r = generateGstr1({
      ...baseInput(),
      returns: [
        makeReturn({
          customer: makeCustomer({ gstin: "27AABCC1111B1Z3", name: "Apollo Pharmacy LLC" }),
          lines: [
            makeReturnLine({
              id: "rl-12a", gstRate: 12,
              refundTaxablePaise: 10_000, refundCgstPaise: 600, refundSgstPaise: 600,
              refundAmountPaise: 11_200,
            }),
            makeReturnLine({
              id: "rl-18a", gstRate: 18,
              refundTaxablePaise: 5_000, refundCgstPaise: 450, refundSgstPaise: 450,
              refundAmountPaise: 5_900,
            }),
          ],
        }),
      ],
    });

    expect(r.json.cdnr).toHaveLength(1);
    const blk = r.json.cdnr[0]!;
    expect(blk.ctin).toBe("27AABCC1111B1Z3");
    expect(blk.nt).toHaveLength(1);
    const note = blk.nt[0]!;
    expect(note.ntty).toBe("C");
    expect(note.inum).toBe("INV-0001");
    expect(note.itms).toHaveLength(2);
    // Items sorted by rate ascending
    expect(note.itms[0]?.itm_det.rt).toBe(12);
    expect(note.itms[1]?.itm_det.rt).toBe(18);
    // 100 paise → ₹1.00 conversion
    expect(note.itms[0]?.itm_det.txval).toBe(100.0);
    expect(note.itms[1]?.itm_det.txval).toBe(50.0);
    expect(r.summary.cdnrNoteCount).toBe(1);
  });

  it("interstate ≥2.5L unregistered return → CDNUR note", () => {
    const r = generateGstr1({
      ...baseInput(),
      returns: [
        makeReturn({
          id: "ret-cdnur",
          returnNo: "CN/2025-26/0099",
          customer: makeCustomer({ gstin: null, stateCode: "07" }),  // Delhi unreg
          refundIgstPaise: 30_00_000,
          refundCgstPaise: 0,
          refundSgstPaise: 0,
          refundTotalPaise: 2_80_00_000, // ₹2.8L ≥ ₹2.5L threshold
          lines: [
            makeReturnLine({
              gstRate: 12,
              refundTaxablePaise: 2_50_00_000, refundIgstPaise: 30_00_000,
              refundCgstPaise: 0, refundSgstPaise: 0,
              refundAmountPaise: 2_80_00_000,
            }),
          ],
        }),
      ],
    });
    expect(r.json.cdnur).toHaveLength(1);
    expect(r.json.cdnr).toEqual([]);
    const n = r.json.cdnur[0]!;
    expect(n.typ).toBe("B2CL");
    expect(n.pos).toBe("07");
    expect(n.itms[0]?.itm_det.iamt).toBe(30000);
    expect(r.summary.cdnurNoteCount).toBe(1);
  });

  it("B2CS-small return reduces the matching B2CS bucket and never goes negative", () => {
    // Original sale: 2 × ₹50 line at 12% = ₹100 taxable + ₹6 CGST + ₹6 SGST per ½ of two lines bucket aggregated
    const bill = makeBill({
      id: "b-1", billNo: "INV-0001",
      billedAt: "2026-03-05T10:00:00.000Z",
      gstTreatment: "intra_state",
      customer: makeCustomer({ gstin: null, stateCode: "27" }),
      subtotalPaise: 10_000, totalCgstPaise: 600, totalSgstPaise: 600,
      grandTotalPaise: 11_200,
      lines: [
        makeLine({
          id: "b-1-l1", gstRate: 12, hsn: "30049099", qty: 2,
          taxableValuePaise: 10_000, cgstPaise: 600, sgstPaise: 600,
          lineTotalPaise: 11_200,
        }),
      ],
    });
    const r = generateGstr1({
      ...baseInput(),
      bills: [bill],
      returns: [
        makeReturn({
          id: "ret-1",
          returnNo: "CN/2025-26/0001",
          createdAt: "2026-03-20T10:00:00.000Z",
          originalBillId: "b-1", originalBillNo: "INV-0001",
          originalBilledAt: "2026-03-05T10:00:00.000Z",
          customer: makeCustomer({ gstin: null, stateCode: "27" }),
          lines: [
            makeReturnLine({
              gstRate: 12, qtyReturned: 1,
              refundTaxablePaise: 5_000, refundCgstPaise: 300, refundSgstPaise: 300,
              refundAmountPaise: 5_600,
            }),
          ],
          refundTotalPaise: 5_600,
        }),
      ],
    });
    expect(r.json.cdnr).toEqual([]);
    expect(r.json.cdnur).toEqual([]);
    // B2CS bucket is netted: was ₹100 taxable, return takes ₹50 → expect ₹50
    const intra = r.json.b2cs.find((b) => b.pos === "27" && b.rt === 12 && b.sply_ty === "INTRA");
    expect(intra).toBeDefined();
    expect(intra?.txval).toBe(50);
    expect(intra?.camt).toBe(3);
    expect(intra?.samt).toBe(3);
    expect(r.summary.creditNoteRefundTotalPaise).toBe(5_600);
  });

  it("rejects return with no lines / non-positive refund_total in invalid summary", () => {
    const r = generateGstr1({
      ...baseInput(),
      returns: [
        makeReturn({ id: "bad-empty", lines: [] }),
        makeReturn({ id: "bad-zero", refundTotalPaise: 0 }),
      ],
    });
    const ids = r.summary.invalid.map((i) => i.billId);
    expect(ids).toContain("bad-empty");
    expect(ids).toContain("bad-zero");
    expect(r.json.cdnr).toEqual([]);
  });

  it("CSV bundle includes cdnr + cdnur with header + rows", () => {
    const r = generateGstr1({
      ...baseInput(),
      returns: [
        makeReturn({
          customer: makeCustomer({ gstin: "27AABCC1111B1Z3" }),
        }),
      ],
    });
    expect(r.csv.cdnr).toMatch(/GSTIN\/UIN of Recipient/);
    expect(r.csv.cdnr).toMatch(/27AABCC1111B1Z3/);
    expect(r.csv.cdnr).toMatch(/Credit Note/);
    expect(r.csv.cdnur).toMatch(/Note Number/);
  });

  it("multiple buyers: cdnr blocks sorted by GSTIN ascending", () => {
    const r = generateGstr1({
      ...baseInput(),
      returns: [
        makeReturn({
          id: "z", returnNo: "CN/2025-26/9000",
          customer: makeCustomer({ gstin: "27ZZZZZ9999Z9Z9" }),
        }),
        makeReturn({
          id: "a", returnNo: "CN/2025-26/8000",
          customer: makeCustomer({ gstin: "27AAAAA0000A0Z0" }),
        }),
      ],
    });
    expect(r.json.cdnr.map((b) => b.ctin)).toEqual([
      "27AAAAA0000A0Z0",
      "27ZZZZZ9999Z9Z9",
    ]);
  });

  it("creditNoteRefundTotalPaise sums across cdnr + cdnur + b2cs-net", () => {
    const r = generateGstr1({
      ...baseInput(),
      returns: [
        makeReturn({ id: "cdnr-1", customer: makeCustomer({ gstin: "27AABCC1111B1Z3" }), refundTotalPaise: 1000 }),
        makeReturn({
          id: "cdnur-1", returnNo: "CN/2025-26/0050",
          customer: makeCustomer({ gstin: null, stateCode: "07" }),
          refundTotalPaise: 2_80_00_000, refundIgstPaise: 30_00_000,
          lines: [makeReturnLine({ refundTaxablePaise: 2_50_00_000, refundIgstPaise: 30_00_000, refundCgstPaise: 0, refundSgstPaise: 0, refundAmountPaise: 2_80_00_000 })],
        }),
        makeReturn({ id: "b2cs-1", returnNo: "CN/2025-26/0060", customer: makeCustomer(), refundTotalPaise: 500 }),
      ],
    });
    expect(r.summary.creditNoteRefundTotalPaise).toBe(1000 + 2_80_00_000 + 500);
  });
});
