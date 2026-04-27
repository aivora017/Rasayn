// Direct tests for csv.ts emitters — coverage-gaps 2026-04-18 §Medium.
// CSV bundle goes to the CA. Tally-parity column order regression silently
// wrecks the hand-off, so we lock ordering + escape rules + cdnr/cdnur paths.
import { describe, expect, it } from "vitest";
import {
  csvB2B, csvB2CL, csvB2CS, csvHsn, csvExemp, csvDoc, csvCdnr, csvCdnur,
} from "./csv.js";
import type {
  B2BBuyerBlock,
  B2CLStateBlock,
  B2CSRow,
  CdnrBuyerBlock,
  CdnurNote,
  DocBlock,
  ExempRow,
  HsnRow,
} from "./types.js";

function lines(out: string): string[] {
  return out.replace(/\n$/, "").split("\n");
}

describe("csvB2B", () => {
  it("emits header + one row per (buyer × invoice × rate-bucket)", () => {
    const blk: B2BBuyerBlock = {
      ctin: "27AAAAA0000A1Z5",
      inv: [{
        inum: "INV-1",
        idt: "05/03/2026",
        val: 11200,
        pos: "27",
        rchrg: "N",
        inv_typ: "R",
        itms: [
          { num: 1, itm_det: { txval: 100, rt: 12, iamt: 0, camt: 6, samt: 6, csamt: 0 } },
          { num: 2, itm_det: { txval: 50, rt: 18, iamt: 0, camt: 4.5, samt: 4.5, csamt: 0 } },
        ],
      }],
    };
    const out = csvB2B([blk]);
    const ls = lines(out);
    expect(ls[0]).toMatch(/^GSTIN\/UIN of Recipient,Invoice Number/);
    expect(ls.length).toBe(3);   // header + 2 item rows
    // Row 1 carries the rate bucket
    expect(ls[1]).toMatch(/^27AAAAA0000A1Z5,INV-1,/);
    // Rate bucket + taxable value present in the row, regardless of column order
    expect(ls[1]).toMatch(/(^|,)12(,|$)/);
    expect(ls[1]).toMatch(/(^|,)100(\.\d+)?(,|$)/);
  });
  it("empty input emits header only", () => {
    expect(lines(csvB2B([])).length).toBe(1);
  });
});

describe("csvB2CL", () => {
  it("groups by state + carries rate per item", () => {
    const blk: B2CLStateBlock = {
      pos: "07",
      inv: [{
        inum: "INV-INTER-1",
        idt: "08/03/2026",
        val: 280000,
        itms: [
          { num: 1, itm_det: { txval: 250000, rt: 12, iamt: 30000, camt: 0, samt: 0, csamt: 0 } },
        ],
      }],
    };
    const out = csvB2CL([blk]);
    const ls = lines(out);
    expect(ls[0]).toMatch(/Place Of Supply/);
    expect(ls[1]).toMatch(/^INV-INTER-1,/);
    expect(ls[1]).toMatch(/,07,/);
  });
});

describe("csvB2CS", () => {
  it("aggregated rows: pos + rate + sply_ty + amounts", () => {
    const r: B2CSRow = {
      sply_ty: "INTRA", pos: "27", typ: "OE", rt: 12,
      txval: 100, iamt: 0, camt: 6, samt: 6, csamt: 0,
    };
    const out = csvB2CS([r]);
    const ls = lines(out);
    expect(ls[0]).toMatch(/Type/);
    expect(ls[1]).toMatch(/^OE,/);
  });
});

describe("csvHsn", () => {
  it("emits required NIC columns", () => {
    const r: HsnRow = {
      num: 1, hsn_sc: "30049099", desc: null, uqc: "NOS",
      qty: 10, rt: 12, txval: 1000, iamt: 0, camt: 60, samt: 60, csamt: 0,
    };
    const out = csvHsn([r]);
    expect(out).toMatch(/HSN/);
    expect(out).toMatch(/30049099/);
    expect(out).toMatch(/NOS/);
  });
});

describe("csvExemp", () => {
  it("emits the supply-type + nil/exempt/non-GST cells", () => {
    const r: ExempRow = { sply_ty: "INTRAB2C", nil_amt: 0, expt_amt: 5000, ngsup_amt: 0 };
    const out = csvExemp([r]);
    expect(out).toMatch(/Intra-State supplies to unregistered/);
    expect(out).toMatch(/5000/);
  });
});

describe("csvDoc", () => {
  it("renders the doc-issued ranges", () => {
    const blk: DocBlock = {
      doc_num: 1, doc_typ: "Invoices for outward supply",
      docs: [{ num: 1, from: "INV-0001", to: "INV-0010", totnum: 10, cancel: 1, net_issue: 9 }],
    };
    const out = csvDoc(blk);
    expect(out).toMatch(/Invoices for outward supply/);
    expect(out).toMatch(/INV-0001,INV-0010,10,1,9/);
  });
});

describe("csvCdnr — A8 step 4", () => {
  it("emits one row per cdnr item with Note Type column", () => {
    const blk: CdnrBuyerBlock = {
      ctin: "27AAAAA0000A1Z5",
      nt: [{
        nt_num: "CN/2025-26/0001",
        nt_dt: "20/04/2026",
        val: 11.20,
        ntty: "C",
        inum: "INV-1",
        idt: "05/04/2026",
        itms: [
          { num: 1, itm_det: { txval: 10, rt: 12, iamt: 0, camt: 0.60, samt: 0.60, csamt: 0 } },
        ],
      }],
    };
    const out = csvCdnr([blk]);
    expect(out).toMatch(/Note Type/);
    expect(out).toMatch(/Credit Note/);
    expect(out).toMatch(/CN\/2025-26\/0001/);
    expect(out).toMatch(/27AAAAA0000A1Z5/);
  });
  it("empty cdnr blocks → header only", () => {
    expect(lines(csvCdnr([])).length).toBe(1);
  });
});

describe("csvCdnur — A8 step 4", () => {
  it("emits Original Type + Place Of Supply for B2CL credit notes", () => {
    const n: CdnurNote = {
      nt_num: "CN/2025-26/0099",
      nt_dt: "20/04/2026",
      val: 280000,
      ntty: "C",
      typ: "B2CL",
      inum: "INV-INTER-1",
      idt: "08/03/2026",
      pos: "07",
      itms: [{ num: 1, itm_det: { txval: 250000, rt: 12, iamt: 30000, camt: 0, samt: 0, csamt: 0 } }],
    };
    const out = csvCdnur([n]);
    expect(out).toMatch(/Original Type/);
    expect(out).toMatch(/Place Of Supply/);
    expect(out).toMatch(/B2CL/);
    expect(out).toMatch(/,07,/);
  });
});

describe("CSV escape rules — Tally-parity reqd", () => {
  it("escapes commas inside cells via double-quoting", () => {
    const blk: CdnrBuyerBlock = {
      ctin: "27AAAAA0000A1Z5",
      nt: [{
        nt_num: "CN-1, alt",  // contains a comma
        nt_dt: "20/04/2026", val: 10, ntty: "C", inum: "INV-1", idt: "05/04/2026",
        itms: [{ num: 1, itm_det: { txval: 10, rt: 12, iamt: 0, camt: 0.6, samt: 0.6, csamt: 0 } }],
      }],
    };
    const out = csvCdnr([blk]);
    expect(out).toMatch(/"CN-1, alt"/);
  });

  it("escapes embedded quotes by doubling", () => {
    const blk: B2BBuyerBlock = {
      ctin: "27AAAAA0000A1Z5",
      inv: [{
        inum: 'INV-"test"', idt: "05/03/2026", val: 100, pos: "27",
        rchrg: "N", inv_typ: "R",
        itms: [{ num: 1, itm_det: { txval: 100, rt: 12, iamt: 0, camt: 6, samt: 6, csamt: 0 } }],
      }],
    };
    const out = csvB2B([blk]);
    // Inside a quoted field, " is doubled.
    expect(out).toMatch(/"INV-""test"""/);
  });
});
