import { describe, it, expect } from "vitest";
import { generateGstr1, gstr1Filename, serialiseJson } from "./index.js";
import { makeShop, makeBill, makeCustomer, makeLine, makeSampleMarch2026 } from "./fixtures.js";

describe("generateGstr1 — empty period", () => {
  it("empty bills produces schema-valid empty sections", () => {
    const res = generateGstr1({
      period: { mm: "03", yyyy: "2026" },
      shop: makeShop(),
      bills: [],
    });
    expect(res.json.gstin).toBe("27ABCDE1234F1Z5");
    expect(res.json.fp).toBe("032026");
    expect(res.json.b2b).toEqual([]);
    expect(res.json.b2cl).toEqual([]);
    expect(res.json.b2cs).toEqual([]);
    expect(res.json.hsn.hsn_b2b.data).toEqual([]);
    expect(res.json.hsn.hsn_b2c.data).toEqual([]);
    expect(res.json.doc_issue.doc_det).toEqual([{ doc_num: 1, doc_typ: "Invoices for outward supply", docs: [] }]);
    expect(res.summary.billCount).toBe(0);
    expect(res.summary.grandTotalPaise).toBe(0);
  });
});

describe("generateGstr1 — March 2026 mixed sample", () => {
  const res = generateGstr1({
    period: { mm: "03", yyyy: "2026" },
    shop: makeShop(),
    bills: makeSampleMarch2026(),
  });

  it("filters out February bill (out of period)", () => {
    expect(res.summary.invalid.find((x) => x.billId === "b-feb")).toBeUndefined();
    // b-feb appears NOWHERE in the JSON bills (period-filtered before classification)
    const allInums: string[] = [
      ...res.json.b2b.flatMap((b) => b.inv.map((i) => i.inum)),
      ...res.json.b2cl.flatMap((b) => b.inv.map((i) => i.inum)),
    ];
    expect(allInums).not.toContain("INV-0005");
  });

  it("classifies B2B vs B2CL vs B2CS correctly", () => {
    expect(res.json.b2b.length).toBe(1);           // b-2 (Metro Clinic)
    expect(res.json.b2b[0]!.ctin).toBe("27XYZAB1234G1Z1");
    expect(res.json.b2cl.length).toBe(1);          // b-3 (Delhi ₹2.24L)
    expect(res.json.b2cl[0]!.pos).toBe("07");
    // b2cs has b-1, b-exempt lines aggregated by pos+rate; voided b-4 excluded
    const b2cs = res.json.b2cs;
    // Expect 2 rows: one 0-rate exempt (INTRA 27 @ 0) and one 12% (INTRA 27 @ 12)
    const rates = b2cs.map((r) => r.rt).sort();
    expect(rates).toEqual([0, 12]);
  });

  it("HSN split: B2B HSN block has Metro Clinic lines; B2C HSN block has B2CL+B2CS lines", () => {
    expect(res.json.hsn.hsn_b2b.data.length).toBeGreaterThan(0);
    expect(res.json.hsn.hsn_b2c.data.length).toBeGreaterThan(0);
    // Check HSN aggregation: B2B Metro is 1 row (hsn 30049099 @ 12%)
    expect(res.json.hsn.hsn_b2b.data.length).toBe(1);
    const b2bHsn = res.json.hsn.hsn_b2b.data[0]!;
    expect(b2bHsn.hsn_sc).toBe("30049099");
    expect(b2bHsn.rt).toBe(12);
    expect(b2bHsn.txval).toBe(500);  // ₹500
  });

  it("DOC block counts voided in cancel, reports net_issue", () => {
    const doc = res.json.doc_issue.doc_det[0]!;
    expect(doc.docs.length).toBe(1);          // all in INV series
    const row = doc.docs[0]!;
    expect(row.from).toBe("INV-0001");
    // INV-0001 through INV-0006 in March (INV-0005 is Feb & excluded from period)
    expect(row.totnum).toBe(5);               // 5 March bills incl voided
    expect(row.cancel).toBe(1);               // b-4 voided
    expect(row.net_issue).toBe(4);
  });

  it("DOC block flags gap between 0004 and 0006 (0005 filtered out)", () => {
    expect(res.summary.gaps.length).toBe(1);
    expect(res.summary.gaps[0]!.series).toBe("INV");
    expect(res.summary.gaps[0]!.gapNums).toEqual(["5"]);
  });

  it("EXEMP has INTRAB2C row with expt_amt=50 (from b-exempt bill)", () => {
    const rows = res.json.nil.inv;
    const intraB2c = rows.find((r) => r.sply_ty === "INTRAB2C");
    expect(intraB2c).toBeDefined();
    expect(intraB2c!.expt_amt).toBe(50);
  });

  it("summary counts all sections", () => {
    expect(res.summary.b2bCount).toBe(1);
    expect(res.summary.b2clCount).toBe(1);
    expect(res.summary.b2csRowCount).toBeGreaterThan(0);
    expect(res.summary.hsnB2bRowCount).toBe(1);
    expect(res.summary.hsnB2cRowCount).toBeGreaterThanOrEqual(1);
    expect(res.summary.billCount).toBe(4); // non-voided March bills (b-1, b-2, b-3, b-exempt)
  });

  it("CSV bundle present and non-empty for each section", () => {
    expect(res.csv.b2b.split("\n").length).toBeGreaterThan(1);
    expect(res.csv.b2cl.split("\n").length).toBeGreaterThan(1);
    expect(res.csv.b2cs.split("\n").length).toBeGreaterThan(1);
    expect(res.csv.hsn.split("\n").length).toBeGreaterThan(1);
    expect(res.csv.exemp.split("\n").length).toBeGreaterThan(1);
    expect(res.csv.doc.split("\n").length).toBeGreaterThan(1);
  });
});

describe("generateGstr1 — validation", () => {
  it("surfaces invalid bills with reason without crashing", () => {
    const res = generateGstr1({
      period: { mm: "03", yyyy: "2026" },
      shop: makeShop(),
      bills: [
        makeBill({
          id: "bad",
          billNo: "",
          customer: makeCustomer({ gstin: "SHORT" }),
        }),
      ],
    });
    expect(res.summary.invalid.length).toBe(1);
    expect(res.summary.invalid[0]!.billId).toBe("bad");
    expect(res.summary.billCount).toBe(0);
  });
});

describe("gstr1Filename", () => {
  it("matches GSTN offline-tool default pattern", () => {
    expect(gstr1Filename("03", "2026", "27ABCDE1234F1Z5"))
      .toBe("032026_GSTR1_27ABCDE1234F1Z5.json");
  });
});

describe("serialiseJson + deterministic ordering", () => {
  it("same input → same output bytes (hash stable)", () => {
    const a = generateGstr1({
      period: { mm: "03", yyyy: "2026" },
      shop: makeShop(),
      bills: makeSampleMarch2026(),
    });
    const b = generateGstr1({
      period: { mm: "03", yyyy: "2026" },
      shop: makeShop(),
      bills: makeSampleMarch2026(),
    });
    expect(serialiseJson(a.json)).toBe(serialiseJson(b.json));
  });

  it("input order doesn't affect output (bills shuffled)", () => {
    const arr1 = makeSampleMarch2026();
    const arr2 = [...arr1].reverse();
    const a = generateGstr1({
      period: { mm: "03", yyyy: "2026" },
      shop: makeShop(),
      bills: arr1,
    });
    const b = generateGstr1({
      period: { mm: "03", yyyy: "2026" },
      shop: makeShop(),
      bills: arr2,
    });
    expect(serialiseJson(a.json)).toBe(serialiseJson(b.json));
  });
});

describe("paise precision — no float drift on aggregation", () => {
  it("sum of 100,000 × 1-paise lines equals ₹1,000", () => {
    // 100k lines × 1 paise → 1,00,000 paise → ₹1,000
    const lines = [];
    for (let i = 0; i < 100_000; i++) {
      lines.push(makeLine({
        id: `l-${i}`, hsn: "30049099", gstRate: 5,
        taxableValuePaise: 1, cgstPaise: 0, sgstPaise: 0,
        lineTotalPaise: 1, qty: 0.001,
      }));
    }
    const res = generateGstr1({
      period: { mm: "03", yyyy: "2026" },
      shop: makeShop(),
      bills: [
        makeBill({
          id: "big", billNo: "INV-9999",
          billedAt: "2026-03-15T10:00:00.000Z",
          subtotalPaise: 100_000, totalCgstPaise: 0, totalSgstPaise: 0,
          grandTotalPaise: 100_000,
          lines,
        }),
      ],
    });
    const hsnRow = res.json.hsn.hsn_b2c.data.find((r) => r.rt === 5);
    expect(hsnRow).toBeDefined();
    expect(hsnRow!.txval).toBe(1000);  // ₹1000 exactly
  });
});
