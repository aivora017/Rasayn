// Direct tests for aggregate.ts helper functions — coverage-gaps 2026-04-18
// §Medium. The big classifier is exercised via index.test.ts; this file
// pins down the per-function behavior.
import { describe, expect, it } from "vitest";
import {
  buildB2BBlocks,
  buildB2CLBlocks,
  buildB2CSRows,
  buildHsnBlocks,
  buildExempRows,
  buildDocBlock,
  classifyReturns,
  netB2csForReturns,
} from "./aggregate.js";
import { makeBill, makeCustomer, makeLine, makeReturn, makeReturnLine } from "./fixtures.js";
import type { B2CSRow } from "./types.js";

const SHOP_STATE = "27"; // Maharashtra

describe("buildB2BBlocks", () => {
  it("groups multiple bills by buyer GSTIN, sorts ctin asc + invoice no asc inside", () => {
    const b1 = makeBill({
      id: "b-1", billNo: "INV-002", customer: makeCustomer({ gstin: "27ZZZZZ9999Z9Z9" }),
    });
    const b2 = makeBill({
      id: "b-2", billNo: "INV-001", customer: makeCustomer({ gstin: "27ZZZZZ9999Z9Z9" }),
    });
    const b3 = makeBill({
      id: "b-3", billNo: "INV-003", customer: makeCustomer({ gstin: "27AAAAA0000A0Z0" }),
    });
    const out = buildB2BBlocks([b1, b2, b3]);
    expect(out.length).toBe(2);
    expect(out[0]?.ctin).toBe("27AAAAA0000A0Z0");
    expect(out[1]?.ctin).toBe("27ZZZZZ9999Z9Z9");
    // Inside the second block, INV-001 comes before INV-002.
    expect(out[1]?.inv[0]?.inum).toBe("INV-001");
    expect(out[1]?.inv[1]?.inum).toBe("INV-002");
  });

  it("aggregates lines by GST rate inside a single invoice", () => {
    const b = makeBill({
      id: "b-1",
      customer: makeCustomer({ gstin: "27AAAAA0000A0Z0" }),
      lines: [
        makeLine({ id: "l1", gstRate: 12, taxableValuePaise: 10_000, cgstPaise: 600, sgstPaise: 600, lineTotalPaise: 11_200 }),
        makeLine({ id: "l2", gstRate: 12, taxableValuePaise: 5_000, cgstPaise: 300, sgstPaise: 300, lineTotalPaise: 5_600 }),
        makeLine({ id: "l3", gstRate: 18, taxableValuePaise: 4_000, cgstPaise: 360, sgstPaise: 360, lineTotalPaise: 4_720 }),
      ],
    });
    const out = buildB2BBlocks([b]);
    const inv = out[0]?.inv[0]!;
    // Two rate buckets: 12 and 18, sorted asc.
    expect(inv.itms.length).toBe(2);
    expect(inv.itms[0]?.itm_det.rt).toBe(12);
    expect(inv.itms[0]?.itm_det.txval).toBe(150);
    expect(inv.itms[1]?.itm_det.rt).toBe(18);
  });

  it("empty input returns empty array", () => {
    expect(buildB2BBlocks([])).toEqual([]);
  });
});

describe("buildB2CLBlocks", () => {
  it("groups by place-of-supply state, not by buyer", () => {
    const delhi = makeBill({
      id: "b-1", billNo: "INV-1",
      customer: makeCustomer({ gstin: null, stateCode: "07" }),
      gstTreatment: "inter_state",
      // ≥1L for B2CL classification (caller is responsible — this fn just groups)
    });
    const karnataka = makeBill({
      id: "b-2", billNo: "INV-2",
      customer: makeCustomer({ gstin: null, stateCode: "29" }),
      gstTreatment: "inter_state",
    });
    const out = buildB2CLBlocks([delhi, karnataka], SHOP_STATE);
    expect(out.length).toBe(2);
    const states = out.map((b) => b.pos).sort();
    expect(states).toEqual(["07", "29"]);
  });
});

describe("buildB2CSRows", () => {
  it("aggregates intra-state bills into pos+rate buckets", () => {
    const lines = [
      makeLine({ id: "l1", gstRate: 12, taxableValuePaise: 10_000, cgstPaise: 600, sgstPaise: 600, lineTotalPaise: 11_200 }),
    ];
    const b1 = makeBill({ id: "b-1", customer: makeCustomer({ stateCode: "27" }), gstTreatment: "intra_state", lines });
    const b2 = makeBill({ id: "b-2", customer: makeCustomer({ stateCode: "27" }), gstTreatment: "intra_state", lines });
    const out = buildB2CSRows([b1, b2], SHOP_STATE);
    const intra12 = out.find((r) => r.sply_ty === "INTRA" && r.rt === 12 && r.pos === "27");
    expect(intra12).toBeDefined();
    expect(intra12?.txval).toBe(200);
  });

  it("interstate bills get sply_ty = INTER", () => {
    const lines = [
      makeLine({ id: "l1", gstRate: 12, taxableValuePaise: 10_000, igstPaise: 1200, cgstPaise: 0, sgstPaise: 0, lineTotalPaise: 11_200 }),
    ];
    const b = makeBill({ id: "b-1", customer: makeCustomer({ stateCode: "07" }), gstTreatment: "inter_state", lines });
    const out = buildB2CSRows([b], SHOP_STATE);
    const r = out.find((x) => x.pos === "07" && x.rt === 12);
    expect(r?.sply_ty).toBe("INTER");
    expect(r?.iamt).toBe(12);
  });
});

describe("buildHsnBlocks", () => {
  it("separates B2B from B2C HSN aggregations (2025 split)", () => {
    const b2bBill = makeBill({ id: "b-1", customer: makeCustomer({ gstin: "27AAAAA0000A0Z0" }) });
    const b2cBill = makeBill({ id: "b-2", customer: makeCustomer() });
    const out = buildHsnBlocks([b2bBill], [b2cBill]);
    expect(out.hsn_b2b.data.length).toBeGreaterThan(0);
    expect(out.hsn_b2c.data.length).toBeGreaterThan(0);
  });
});

describe("buildExempRows", () => {
  it("produces rows for exempt bills by sply_ty bucket", () => {
    const b = makeBill({
      id: "b-1",
      customer: makeCustomer(),
      gstTreatment: "exempt",
      subtotalPaise: 5000,
      totalCgstPaise: 0, totalSgstPaise: 0,
      grandTotalPaise: 5000,
      lines: [makeLine({ gstRate: 0, taxableValuePaise: 5000, cgstPaise: 0, sgstPaise: 0, lineTotalPaise: 5000 })],
    });
    const out = buildExempRows([b], SHOP_STATE);
    expect(out.length).toBeGreaterThan(0);
    // Some exempt-row variant should have non-zero exempt or nil amount.
    expect(out.some((r) => r.expt_amt > 0 || r.nil_amt > 0)).toBe(true);
  });
});

describe("buildDocBlock", () => {
  it("emits ranges + cancellation count + flags numeric-tail gaps", () => {
    const bills = [
      makeBill({ id: "b-1", billNo: "INV-0001" }),
      makeBill({ id: "b-2", billNo: "INV-0002" }),
      // gap: INV-0003 missing
      makeBill({ id: "b-4", billNo: "INV-0004" }),
      makeBill({ id: "b-5", billNo: "INV-0005", isVoided: 1 }),
    ];
    const out = buildDocBlock(bills);
    expect(out.block.docs[0]?.from).toBe("INV-0001");
    expect(out.block.docs[0]?.to).toBe("INV-0005");
    expect(out.block.docs[0]?.totnum).toBe(4);
    expect(out.block.docs[0]?.cancel).toBe(1);
    expect(out.block.docs[0]?.net_issue).toBe(3);
    // Gap-detection: 0003 reported missing.
    expect(out.gaps[0]?.gapNums).toContain("3");
  });

  it("non-numeric bill nos do not produce a gap entry", () => {
    const bills = [
      makeBill({ id: "b-1", billNo: "ALPHA" }),
      makeBill({ id: "b-2", billNo: "BRAVO" }),
    ];
    const out = buildDocBlock(bills);
    expect(out.gaps).toEqual([]);
  });
});

describe("classifyReturns", () => {
  it("rejects empty-lines + non-positive total into invalid bucket", () => {
    const r = classifyReturns([
      makeReturn({ id: "bad-empty", lines: [] }),
      makeReturn({ id: "bad-zero", refundTotalPaise: 0, lines: [makeReturnLine()] }),
    ], SHOP_STATE);
    expect(r.invalid.map((x) => x.returnId)).toEqual(expect.arrayContaining(["bad-empty", "bad-zero"]));
    expect(r.cdnr).toEqual([]);
    expect(r.cdnur).toEqual([]);
  });

  it("interstate unreg + ≥₹2.5L → cdnur, intra unreg → b2csNet, B2B → cdnr", () => {
    const cdnr = makeReturn({ id: "r-cdnr", customer: makeCustomer({ gstin: "27ABC" }) });
    const cdnur = makeReturn({
      id: "r-cdnur",
      customer: makeCustomer({ gstin: null, stateCode: "07" }),
      refundTotalPaise: 2_80_00_000, // ₹2.8L
    });
    const b2cs = makeReturn({ id: "r-b2cs", customer: makeCustomer() });
    const r = classifyReturns([cdnr, cdnur, b2cs], SHOP_STATE);
    expect(r.cdnr.map((x) => x.id)).toEqual(["r-cdnr"]);
    expect(r.cdnur.map((x) => x.id)).toEqual(["r-cdnur"]);
    expect(r.b2csNet.map((x) => x.id)).toEqual(["r-b2cs"]);
  });
});

describe("netB2csForReturns", () => {
  it("subtracts return tax from matching B2CS bucket; clamps at 0", () => {
    const initial: B2CSRow[] = [
      { sply_ty: "INTRA", pos: "27", typ: "OE", rt: 12, txval: 100, iamt: 0, camt: 6, samt: 6, csamt: 0 },
    ];
    const ret = makeReturn({
      id: "r-1",
      customer: makeCustomer({ stateCode: "27" }),
      lines: [
        makeReturnLine({
          gstRate: 12,
          refundTaxablePaise: 5000,
          refundCgstPaise: 300,
          refundSgstPaise: 300,
          refundIgstPaise: 0,
          refundAmountPaise: 5600,
        }),
      ],
      refundTotalPaise: 5600,
    });
    const out = netB2csForReturns(initial, [ret], SHOP_STATE);
    const r = out.find((x) => x.pos === "27" && x.rt === 12 && x.sply_ty === "INTRA");
    expect(r?.txval).toBe(50);
    expect(r?.camt).toBe(3);
    expect(r?.samt).toBe(3);
  });

  it("returns to a bucket that doesn't exist are silently dropped", () => {
    const initial: B2CSRow[] = [];
    const ret = makeReturn({
      id: "r-1",
      customer: makeCustomer({ stateCode: "29" }),
      lines: [makeReturnLine({ refundTaxablePaise: 5000 })],
    });
    const out = netB2csForReturns(initial, [ret], SHOP_STATE);
    expect(out).toEqual([]);
  });

  it("empty returns array returns the input rows unchanged", () => {
    const initial: B2CSRow[] = [
      { sply_ty: "INTRA", pos: "27", typ: "OE", rt: 12, txval: 100, iamt: 0, camt: 6, samt: 6, csamt: 0 },
    ];
    const out = netB2csForReturns(initial, [], SHOP_STATE);
    expect(out).toEqual(initial);
  });
});
